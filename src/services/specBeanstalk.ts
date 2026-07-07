import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { unknownErrorMessage } from './errorUtils';
import { parseJsonWithLabel, readJsonFile } from './jsonFiles';
import { isPathInside } from './pathUtils';
import { finiteNumberFromUnknown, recordFromUnknown, recordString, recordsFromUnknown } from './records';

export const DEFAULT_SPEC_BEANSTALK_OUTPUT_DIR = path.join('docs', 'api-spec');
export const SPEC_BEANSTALK_INDEX_FILE = 'spec-beanstalk.md';
export const SPEC_BEANSTALK_TRACE_FILE = 'spec-beanstalk-trace.json';
export const SPEC_BEANSTALK_SUMMARY_FILE = 'spec-beanstalk-summary.json';

export interface SpecBeanstalkGenerationOptions {
  projectPath: string;
  workbookPath: string;
  outputDir?: string;
  pythonPath?: string;
}

export interface SpecBeanstalkSheetSummary {
  name: string;
  state: string;
  cellCount: number;
  formattedCellCount: number;
  fillPalette: string[];
  markdownPath: string;
  warnings: string[];
}

export interface SpecBeanstalkSummary {
  schema: string;
  generatedAt: string;
  sourceWorkbook: string;
  sourceWorkbookSha256: string;
  outputDir: string;
  indexPath: string;
  tracePath: string;
  summaryPath: string;
  sheetCount: number;
  cellCount: number;
  formattedCellCount: number;
  sheets: SpecBeanstalkSheetSummary[];
  absoluteOutputDir: string;
  absoluteIndexPath: string;
  absoluteTracePath: string;
  absoluteSummaryPath: string;
}

export interface SpecBeanstalkProjectStatus {
  projectName: string;
  projectPath: string;
  outputDir: string;
  hasSpec: boolean;
  summary?: SpecBeanstalkSummary;
  issue?: string;
}

export interface SpecBeanstalkTraceabilityRow {
  sheet: string;
  evidence: string;
  markdownPath: string;
  warningCount: number;
}

export interface SpecBeanstalkTraceabilityReport {
  status: 'ready' | 'review' | 'missing';
  summary: string;
  rows: SpecBeanstalkTraceabilityRow[];
}

interface PythonCandidate {
  command: string;
  prefixArgs: string[];
}

export function resolveSpecBeanstalkOutputDir(projectPath: string, outputDir?: string): string {
  const trimmed = (outputDir || DEFAULT_SPEC_BEANSTALK_OUTPUT_DIR).trim();
  if (!trimmed) {
    throw new Error('Spec Beanstalk output directory cannot be empty.');
  }
  const resolved = path.resolve(path.isAbsolute(trimmed) ? trimmed : path.join(projectPath, trimmed));
  if (!isPathInside(resolved, projectPath)) {
    throw new Error('Spec Beanstalk output directory must be inside the selected Java repository.');
  }
  return resolved;
}

export function runSpecBeanstalkGeneration(scriptPath: string, options: SpecBeanstalkGenerationOptions): SpecBeanstalkSummary {
  const projectPath = path.resolve(options.projectPath);
  const workbookPath = path.resolve(options.workbookPath);
  const outputDir = resolveSpecBeanstalkOutputDir(projectPath, options.outputDir);
  validateSpecBeanstalkInputs(scriptPath, projectPath, workbookPath);

  const args = [
    scriptPath,
    '--workbook', workbookPath,
    '--output', outputDir,
    '--repo', projectPath,
  ];
  const failures: string[] = [];
  for (const candidate of pythonCandidates(options.pythonPath)) {
    const result = spawnSync(candidate.command, [...candidate.prefixArgs, ...args], {
      cwd: projectPath,
      encoding: 'utf8',
      stdio: 'pipe',
      maxBuffer: 20 * 1024 * 1024,
      windowsHide: true,
    });
    if (result.error) {
      const errorMessage = unknownErrorMessage(result.error, 'Python launch failed.');
      failures.push(`${candidate.command}: ${errorMessage}`);
      continue;
    }
    if (result.status !== 0) {
      const detail = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
      throw new Error(detail || `Spec Beanstalk generator exited with status ${result.status}.`);
    }
    const summary = parseJsonWithLabel<Record<string, unknown>>(result.stdout || '{}', 'Spec Beanstalk generator stdout', { includePreview: true });
    return specBeanstalkSummaryFromUnknown(summary, projectPath);
  }
  throw new Error(`Could not launch Python for Spec Beanstalk. Tried: ${failures.join('; ') || pythonCandidates(options.pythonPath).map(item => item.command).join(', ')}`);
}

export function inspectSpecBeanstalkProject(projectName: string, projectPath: string, outputDir?: string): SpecBeanstalkProjectStatus {
  const output = resolveSpecBeanstalkOutputDir(projectPath, outputDir);
  const summaryPath = path.join(output, SPEC_BEANSTALK_SUMMARY_FILE);
  if (!fs.existsSync(summaryPath)) {
    const indexPath = path.join(output, SPEC_BEANSTALK_INDEX_FILE);
    const tracePath = path.join(output, SPEC_BEANSTALK_TRACE_FILE);
    const status: SpecBeanstalkProjectStatus = {
      projectName,
      projectPath,
      outputDir: path.relative(projectPath, output).replace(/\\/g, '/'),
      hasSpec: fs.existsSync(indexPath) && fs.existsSync(tracePath),
    };
    if (fs.existsSync(output)) {
      status.issue = 'Summary metadata is missing.';
    }
    return status;
  }
  try {
    const summary = specBeanstalkSummaryFromUnknown(readJsonFile(summaryPath), projectPath);
    return {
      projectName,
      projectPath,
      outputDir: summary.outputDir,
      hasSpec: fs.existsSync(summary.absoluteIndexPath) && fs.existsSync(summary.absoluteTracePath),
      summary,
    };
  } catch (e: unknown) {
    return {
      projectName,
      projectPath,
      outputDir: path.relative(projectPath, output).replace(/\\/g, '/'),
      hasSpec: false,
      issue: unknownErrorMessage(e, 'Spec Beanstalk summary is invalid.'),
    };
  }
}

export function buildSpecBeanstalkPrompt(summary: SpecBeanstalkSummary, scope: string): string {
  const scopeText = scope.trim()
    ? scope.trim()
    : 'Choose the next coherent API implementation slice from the generated spec and continue from there.';
  const traceability = buildSpecBeanstalkTraceabilityReport(summary);
  const sheets = summary.sheets
    .map(sheet => `- ${sheet.name}: ${sheet.cellCount} parsed cells, ${sheet.formattedCellCount} formatted cells, colors ${sheet.fillPalette.join(', ') || 'none'}, Markdown ${sheet.markdownPath}`)
    .join('\n');
  return `You are running Kronos Spec Beanstalk in this Java repository.

Goal:
${scopeText}

Generated spec artifacts:
- Spec index: ${summary.indexPath}
- Cell/style trace: ${summary.tracePath}
- Source workbook: ${summary.sourceWorkbook}
- Source workbook SHA-256: ${summary.sourceWorkbookSha256}
- Traceability status: ${traceability.summary}

Sheets:
${sheets || '- No sheets were parsed.'}

Rules:
1. Read the generated Markdown and JSON trace before editing Java code.
2. Cite the Markdown section and original Excel sheet/cell/range for each implemented behavior or schema field.
3. Treat formatting as requirement evidence. Colors, bold text, merged cells, comments, formulas, hidden rows/columns, and dropdown validations may be meaningful.
4. Do not invent a color legend. If a color/style seems important but no workbook legend defines it, record the uncertainty and ask for human review.
5. If you need to inspect the workbook directly and it is available in this workspace, use Python to read the .xlsx/package metadata. Do not rely on screenshots or lossy copy/paste extraction.
6. Implement in small resumable increments. Update or add Java tests that prove the implemented spec behavior.
7. Do not publish externally, commit, push, or delete unrelated files unless the operator explicitly asks.
8. Maintain a traceability ledger while working: Excel sheet/cell/range, Markdown section, Java file/test touched, and verification result.
9. End with a concise beanstalk report: implemented cells/sections, tests run, assumptions, blockers, and next recommended slice.
`;
}

export function buildSpecBeanstalkTraceabilityReport(summary: SpecBeanstalkSummary | undefined): SpecBeanstalkTraceabilityReport {
  if (!summary) {
    return {
      status: 'missing',
      summary: 'No generated spec artifacts are selected.',
      rows: [],
    };
  }
  const warningCount = summary.sheets.reduce((total, sheet) => total + sheet.warnings.length, 0);
  const colorCount = new Set(summary.sheets.flatMap(sheet => sheet.fillPalette)).size;
  const rows = summary.sheets.map(sheet => ({
    sheet: sheet.name,
    evidence: `${sheet.cellCount} cells, ${sheet.formattedCellCount} formatted, ${sheet.fillPalette.length} colors`,
    markdownPath: sheet.markdownPath,
    warningCount: sheet.warnings.length,
  }));
  const status = summary.sheetCount > 0 && summary.cellCount > 0
    ? warningCount > 0 ? 'review' : 'ready'
    : 'missing';
  return {
    status,
    summary: `${summary.sheetCount} sheets, ${summary.cellCount} cells, ${summary.formattedCellCount} formatted cells, ${colorCount} workbook colors, ${warningCount} warnings. Source ${summary.sourceWorkbookSha256 ? summary.sourceWorkbookSha256.substring(0, 12) : 'hash missing'}.`,
    rows,
  };
}

export function specBeanstalkSummaryFromUnknown(value: unknown, projectPath: string): SpecBeanstalkSummary {
  const record = recordFromUnknown(value);
  const outputDir = recordString(record, 'outputDir') || DEFAULT_SPEC_BEANSTALK_OUTPUT_DIR;
  const indexPath = recordString(record, 'indexPath') || path.join(outputDir, SPEC_BEANSTALK_INDEX_FILE).replace(/\\/g, '/');
  const tracePath = recordString(record, 'tracePath') || path.join(outputDir, SPEC_BEANSTALK_TRACE_FILE).replace(/\\/g, '/');
  const summaryPath = recordString(record, 'summaryPath') || path.join(outputDir, SPEC_BEANSTALK_SUMMARY_FILE).replace(/\\/g, '/');
  return {
    schema: recordString(record, 'schema') || 'kronos.spec-beanstalk.v1',
    generatedAt: recordString(record, 'generatedAt'),
    sourceWorkbook: recordString(record, 'sourceWorkbook'),
    sourceWorkbookSha256: recordString(record, 'sourceWorkbookSha256'),
    outputDir,
    indexPath,
    tracePath,
    summaryPath,
    sheetCount: finiteNumberFromUnknown(record['sheetCount']),
    cellCount: finiteNumberFromUnknown(record['cellCount']),
    formattedCellCount: finiteNumberFromUnknown(record['formattedCellCount']),
    sheets: recordsFromUnknown(record['sheets']).map(specBeanstalkSheetFromUnknown),
    absoluteOutputDir: resolveArtifactPath(projectPath, outputDir),
    absoluteIndexPath: resolveArtifactPath(projectPath, indexPath),
    absoluteTracePath: resolveArtifactPath(projectPath, tracePath),
    absoluteSummaryPath: resolveArtifactPath(projectPath, summaryPath),
  };
}

function specBeanstalkSheetFromUnknown(value: Record<string, unknown>): SpecBeanstalkSheetSummary {
  return {
    name: recordString(value, 'name'),
    state: recordString(value, 'state') || 'visible',
    cellCount: finiteNumberFromUnknown(value['cellCount']),
    formattedCellCount: finiteNumberFromUnknown(value['formattedCellCount']),
    fillPalette: Array.isArray(value['fillPalette'])
      ? value['fillPalette'].map(item => String(item || '').trim()).filter(Boolean)
      : [],
    markdownPath: recordString(value, 'markdownPath'),
    warnings: Array.isArray(value['warnings'])
      ? value['warnings'].map(item => String(item || '').trim()).filter(Boolean)
      : [],
  };
}

function validateSpecBeanstalkInputs(scriptPath: string, projectPath: string, workbookPath: string): void {
  if (!fs.existsSync(scriptPath) || !fs.statSync(scriptPath).isFile()) {
    throw new Error('Spec Beanstalk Python analyzer is missing from the extension package.');
  }
  if (!fs.existsSync(projectPath) || !fs.statSync(projectPath).isDirectory()) {
    throw new Error('Selected Java repository path does not exist.');
  }
  if (!fs.existsSync(workbookPath) || !fs.statSync(workbookPath).isFile()) {
    throw new Error('Selected Excel workbook does not exist.');
  }
  if (!workbookPath.toLowerCase().endsWith('.xlsx')) {
    throw new Error('Spec Beanstalk only accepts .xlsx files.');
  }
}

function pythonCandidates(configured?: string): PythonCandidate[] {
  const candidates: PythonCandidate[] = [];
  const configuredPath = configured?.trim();
  if (configuredPath) {
    candidates.push({ command: configuredPath, prefixArgs: [] });
  }
  candidates.push(
    { command: 'python3', prefixArgs: [] },
    { command: 'python', prefixArgs: [] },
    { command: 'py', prefixArgs: ['-3'] },
  );
  const seen = new Set<string>();
  return candidates.filter(candidate => {
    const key = `${candidate.command}\0${candidate.prefixArgs.join('\0')}`;
    if (seen.has(key)) { return false; }
    seen.add(key);
    return true;
  });
}

function resolveArtifactPath(projectPath: string, artifactPath: string): string {
  const resolved = path.resolve(path.isAbsolute(artifactPath) ? artifactPath : path.join(projectPath, artifactPath));
  if (!isPathInside(resolved, projectPath)) {
    throw new Error(`Spec Beanstalk artifact path is outside the selected repository: ${artifactPath}`);
  }
  return resolved;
}
