import { Ticket } from '../state/types';
import { isRecord, recordsFromUnknown, recordValuesFromUnknown, trimmedStringFromUnknown } from './records';

type EvidenceRecord = object;

export function evidenceNotes(ticket: Ticket): EvidenceRecord[] {
  return recordsFromUnknown(ticket.evidence?.notes);
}

export function evidenceAcceptanceCriteria(ticket: Ticket): EvidenceRecord[] {
  return recordsFromUnknown(ticket.evidence?.acceptance_criteria);
}

export function evidenceChecks(ticket: Ticket): EvidenceRecord[] {
  return recordsFromUnknown(ticket.evidence?.checks);
}

export function evidenceRiskNotes(ticket: Ticket): EvidenceRecord[] {
  return recordsFromUnknown(ticket.evidence?.risk_notes);
}

export function evidenceEnvironmentResults(ticket: Ticket): EvidenceRecord[] {
  return recordValuesFromUnknown(ticket.evidence?.environment_results);
}

export function evidenceRecordCount(ticket: Ticket | null | undefined): number {
  if (!ticket) { return 0; }
  return evidenceNotes(ticket).length + evidenceChecks(ticket).length + evidenceEnvironmentResults(ticket).length;
}

export function evidenceString(record: EvidenceRecord | null | undefined, key: string, fallback = ''): string {
  if (!isRecord(record)) { return fallback; }
  return trimmedStringFromUnknown(record[key], fallback);
}

export function evidenceChecked(record: EvidenceRecord): boolean {
  return isRecord(record) && record['checked'] === true;
}
