#!/usr/bin/env python3
"""Convert an .xlsx workbook into Kronos Spec Beanstalk Markdown and trace JSON.

This intentionally uses only the Python standard library. Enterprise laptops often
cannot install Python packages, and Kronos still needs to preserve workbook layout
signals such as fills, font emphasis, merges, formulas, comments, and validations.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import posixpath
import re
import sys
import zipfile
from typing import Any
from xml.etree import ElementTree as ET

NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships"

REL_WORKSHEET = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"
REL_SHARED_STRINGS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings"
REL_STYLES = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"
REL_COMMENTS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments"
REL_HYPERLINK = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink"


def q(name: str) -> str:
    return f"{{{NS_MAIN}}}{name}"


def rq(name: str) -> str:
    return f"{{{NS_REL}}}{name}"


def now_utc() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def file_sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_xml(zf: zipfile.ZipFile, part: str) -> ET.Element | None:
    try:
        return ET.fromstring(zf.read(part))
    except KeyError:
        return None


def normalize_part(base_part: str, target: str) -> str:
    if target.startswith("/"):
        return target.lstrip("/")
    return posixpath.normpath(posixpath.join(posixpath.dirname(base_part), target))


def rels_part_for(part: str) -> str:
    directory = posixpath.dirname(part)
    basename = posixpath.basename(part)
    return posixpath.join(directory, "_rels", f"{basename}.rels")


def read_rels(zf: zipfile.ZipFile, source_part: str) -> dict[str, dict[str, str]]:
    root = load_xml(zf, rels_part_for(source_part))
    if root is None:
        return {}
    rels: dict[str, dict[str, str]] = {}
    for rel in root.findall(f"{{{NS_PKG_REL}}}Relationship"):
        rel_id = rel.attrib.get("Id", "")
        target = rel.attrib.get("Target", "")
        if not rel_id or not target:
            continue
        rels[rel_id] = {
            "type": rel.attrib.get("Type", ""),
            "target": target,
            "targetMode": rel.attrib.get("TargetMode", ""),
            "part": target if rel.attrib.get("TargetMode") == "External" else normalize_part(source_part, target),
        }
    return rels


def cell_ref_parts(ref: str) -> tuple[str, int]:
    match = re.match(r"^([A-Za-z]+)([0-9]+)$", ref or "")
    if not match:
        return "", 0
    return match.group(1).upper(), int(match.group(2))


def column_to_number(column: str) -> int:
    value = 0
    for char in column.upper():
        if not ("A" <= char <= "Z"):
            return 0
        value = value * 26 + (ord(char) - ord("A") + 1)
    return value


def safe_file_stem(value: str, fallback: str = "sheet", max_len: int = 80) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_.-]+", "-", value).strip("-") or fallback
    if len(cleaned) <= max_len:
        return cleaned
    suffix = hashlib.sha256(value.encode("utf-8")).hexdigest()[:10]
    return f"{cleaned[: max_len - 11]}-{suffix}"


def md_escape(value: Any) -> str:
    text = str(value or "")
    return text.replace("|", "\\|").replace("\r\n", "\n").replace("\r", "\n").replace("\n", "<br>")


def text_content(element: ET.Element | None) -> str:
    if element is None:
        return ""
    return "".join(element.itertext())


def read_shared_strings(zf: zipfile.ZipFile, workbook_rels: dict[str, dict[str, str]]) -> list[str]:
    part = ""
    for rel in workbook_rels.values():
        if rel.get("type") == REL_SHARED_STRINGS:
            part = rel.get("part", "")
            break
    root = load_xml(zf, part or "xl/sharedStrings.xml")
    if root is None:
        return []
    values: list[str] = []
    for item in root.findall(q("si")):
        values.append("".join(node.text or "" for node in item.iter(q("t"))))
    return values


def color_from_node(node: ET.Element | None) -> dict[str, Any] | None:
    if node is None:
        return None
    result = {key: value for key, value in node.attrib.items() if value != ""}
    rgb = result.get("rgb")
    if isinstance(rgb, str) and len(rgb) >= 6:
        result["hex"] = f"#{rgb[-6:].upper()}"
    if not result:
        return None
    return result


def parse_styles(zf: zipfile.ZipFile, workbook_rels: dict[str, dict[str, str]]) -> dict[str, Any]:
    styles_part = ""
    for rel in workbook_rels.values():
        if rel.get("type") == REL_STYLES:
            styles_part = rel.get("part", "")
            break
    root = load_xml(zf, styles_part or "xl/styles.xml")
    if root is None:
        return {"fonts": [], "fills": [], "numberFormats": {}, "cellXfs": []}

    number_formats: dict[str, str] = {
        "0": "General",
        "1": "0",
        "2": "0.00",
        "9": "0%",
        "10": "0.00%",
        "14": "mm-dd-yy",
        "22": "m/d/yy h:mm",
        "49": "@",
    }
    num_fmts = root.find(q("numFmts"))
    if num_fmts is not None:
        for fmt in num_fmts.findall(q("numFmt")):
            fmt_id = fmt.attrib.get("numFmtId")
            fmt_code = fmt.attrib.get("formatCode")
            if fmt_id and fmt_code:
                number_formats[fmt_id] = fmt_code

    fonts: list[dict[str, Any]] = []
    fonts_root = root.find(q("fonts"))
    if fonts_root is not None:
        for font in fonts_root.findall(q("font")):
            fonts.append({
                "bold": font.find(q("b")) is not None,
                "italic": font.find(q("i")) is not None,
                "underline": font.find(q("u")) is not None,
                "strike": font.find(q("strike")) is not None,
                "color": color_from_node(font.find(q("color"))),
                "name": (font.find(q("name")).attrib.get("val") if font.find(q("name")) is not None else ""),
                "size": (font.find(q("sz")).attrib.get("val") if font.find(q("sz")) is not None else ""),
            })

    fills: list[dict[str, Any]] = []
    fills_root = root.find(q("fills"))
    if fills_root is not None:
        for fill in fills_root.findall(q("fill")):
            pattern = fill.find(q("patternFill"))
            fills.append({
                "patternType": pattern.attrib.get("patternType", "") if pattern is not None else "",
                "fgColor": color_from_node(pattern.find(q("fgColor")) if pattern is not None else None),
                "bgColor": color_from_node(pattern.find(q("bgColor")) if pattern is not None else None),
            })

    cell_xfs: list[dict[str, Any]] = []
    xfs_root = root.find(q("cellXfs"))
    if xfs_root is not None:
        for xf in xfs_root.findall(q("xf")):
            alignment = xf.find(q("alignment"))
            cell_xfs.append({
                "fontId": int_or_zero(xf.attrib.get("fontId")),
                "fillId": int_or_zero(xf.attrib.get("fillId")),
                "numFmtId": xf.attrib.get("numFmtId", "0"),
                "formatCode": number_formats.get(xf.attrib.get("numFmtId", "0"), xf.attrib.get("numFmtId", "0")),
                "applyFill": xf.attrib.get("applyFill", ""),
                "applyFont": xf.attrib.get("applyFont", ""),
                "alignment": dict(alignment.attrib) if alignment is not None else {},
            })
    return {"fonts": fonts, "fills": fills, "numberFormats": number_formats, "cellXfs": cell_xfs}


def int_or_zero(value: str | None) -> int:
    try:
        return int(value or "0")
    except ValueError:
        return 0


def style_for(styles: dict[str, Any], style_id: str | None) -> dict[str, Any]:
    idx = int_or_zero(style_id)
    xfs: list[dict[str, Any]] = styles.get("cellXfs", [])
    xf = xfs[idx] if 0 <= idx < len(xfs) else {}
    fonts: list[dict[str, Any]] = styles.get("fonts", [])
    fills: list[dict[str, Any]] = styles.get("fills", [])
    font = fonts[xf.get("fontId", 0)] if 0 <= int_or_zero(str(xf.get("fontId", 0))) < len(fonts) else {}
    fill = fills[xf.get("fillId", 0)] if 0 <= int_or_zero(str(xf.get("fillId", 0))) < len(fills) else {}
    return {
        "styleId": idx,
        "font": font,
        "fill": fill,
        "numberFormat": xf.get("formatCode", "General"),
        "alignment": xf.get("alignment", {}),
    }


def style_signal(style: dict[str, Any]) -> bool:
    font = style.get("font") or {}
    fill = style.get("fill") or {}
    alignment = style.get("alignment") or {}
    return bool(
        style.get("styleId")
        or font.get("bold")
        or font.get("italic")
        or font.get("underline")
        or font.get("color")
        or fill.get("fgColor")
        or fill.get("bgColor")
        or (style.get("numberFormat") and style.get("numberFormat") != "General")
        or alignment
    )


def style_summary(style: dict[str, Any]) -> str:
    parts: list[str] = []
    fill = style.get("fill") or {}
    fg = fill.get("fgColor") or {}
    bg = fill.get("bgColor") or {}
    if fg:
        parts.append(f"fill={fg.get('hex') or json.dumps(fg, sort_keys=True)}")
    if bg:
        parts.append(f"bg={bg.get('hex') or json.dumps(bg, sort_keys=True)}")
    font = style.get("font") or {}
    for key in ["bold", "italic", "underline", "strike"]:
        if font.get(key):
            parts.append(key)
    if font.get("color"):
        color = font["color"]
        parts.append(f"fontColor={color.get('hex') or json.dumps(color, sort_keys=True)}")
    if style.get("numberFormat") and style.get("numberFormat") != "General":
        parts.append(f"numFmt={style['numberFormat']}")
    alignment = style.get("alignment") or {}
    if alignment:
        parts.append(f"alignment={json.dumps(alignment, sort_keys=True)}")
    return "; ".join(parts)


def workbook_sheets(zf: zipfile.ZipFile) -> tuple[list[dict[str, str]], dict[str, dict[str, str]]]:
    workbook_part = "xl/workbook.xml"
    root = load_xml(zf, workbook_part)
    if root is None:
        raise ValueError("Workbook is missing xl/workbook.xml")
    rels = read_rels(zf, workbook_part)
    sheets: list[dict[str, str]] = []
    for idx, sheet in enumerate(root.findall(f".//{q('sheet')}"), start=1):
        rel_id = sheet.attrib.get(rq("id"), "")
        rel = rels.get(rel_id, {})
        if rel.get("type") and rel.get("type") != REL_WORKSHEET:
            continue
        sheets.append({
            "name": sheet.attrib.get("name", f"Sheet{idx}"),
            "sheetId": sheet.attrib.get("sheetId", str(idx)),
            "state": sheet.attrib.get("state", "visible"),
            "part": rel.get("part", ""),
        })
    return sheets, rels


def parse_comments(zf: zipfile.ZipFile, sheet_part: str, sheet_rels: dict[str, dict[str, str]]) -> dict[str, dict[str, str]]:
    comments_part = ""
    for rel in sheet_rels.values():
        if rel.get("type") == REL_COMMENTS:
            comments_part = rel.get("part", "")
            break
    root = load_xml(zf, comments_part)
    if root is None:
        return {}
    authors = [text_content(author) for author in root.findall(f".//{q('authors')}/{q('author')}")]
    comments: dict[str, dict[str, str]] = {}
    for comment in root.findall(f".//{q('comment')}"):
        ref = comment.attrib.get("ref", "")
        author_id = int_or_zero(comment.attrib.get("authorId"))
        comments[ref] = {
            "author": authors[author_id] if 0 <= author_id < len(authors) else "",
            "text": text_content(comment.find(q("text"))),
        }
    return comments


def parse_hyperlinks(sheet_root: ET.Element, sheet_rels: dict[str, dict[str, str]]) -> dict[str, dict[str, str]]:
    hyperlinks: dict[str, dict[str, str]] = {}
    for link in sheet_root.findall(f".//{q('hyperlink')}"):
        ref = link.attrib.get("ref", "")
        rel_id = link.attrib.get(rq("id"), "")
        rel = sheet_rels.get(rel_id, {})
        if not ref:
            continue
        hyperlinks[ref] = {
            "target": rel.get("target") or link.attrib.get("location", ""),
            "display": link.attrib.get("display", ""),
            "tooltip": link.attrib.get("tooltip", ""),
        }
    return hyperlinks


def parse_data_validations(sheet_root: ET.Element) -> list[dict[str, str]]:
    items: list[dict[str, str]] = []
    for validation in sheet_root.findall(f".//{q('dataValidation')}"):
        item = {key: value for key, value in validation.attrib.items() if value}
        formula1 = text_content(validation.find(q("formula1")))
        formula2 = text_content(validation.find(q("formula2")))
        if formula1:
            item["formula1"] = formula1
        if formula2:
            item["formula2"] = formula2
        items.append(item)
    return items


def parse_merges(sheet_root: ET.Element) -> list[str]:
    return [node.attrib.get("ref", "") for node in sheet_root.findall(f".//{q('mergeCell')}") if node.attrib.get("ref")]


def parse_hidden_columns(sheet_root: ET.Element) -> list[dict[str, str]]:
    hidden: list[dict[str, str]] = []
    for col in sheet_root.findall(f".//{q('col')}"):
        if col.attrib.get("hidden") in {"1", "true", "TRUE"}:
            hidden.append({key: col.attrib.get(key, "") for key in ["min", "max", "width"] if col.attrib.get(key)})
    return hidden


def parse_cell_value(cell: ET.Element, shared_strings: list[str]) -> str:
    cell_type = cell.attrib.get("t", "")
    if cell_type == "inlineStr":
        return text_content(cell.find(q("is")))
    value_node = cell.find(q("v"))
    raw = text_content(value_node)
    if cell_type == "s":
        idx = int_or_zero(raw)
        return shared_strings[idx] if 0 <= idx < len(shared_strings) else raw
    if cell_type == "b":
        return "TRUE" if raw == "1" else "FALSE" if raw == "0" else raw
    return raw


def parse_sheet(
    zf: zipfile.ZipFile,
    sheet_info: dict[str, str],
    index: int,
    shared_strings: list[str],
    styles: dict[str, Any],
) -> dict[str, Any]:
    part = sheet_info.get("part", "")
    root = load_xml(zf, part)
    if root is None:
        return {
            "name": sheet_info["name"],
            "sheetIndex": index,
            "sheetId": sheet_info.get("sheetId", ""),
            "state": sheet_info.get("state", "visible"),
            "part": part,
            "warnings": [f"Worksheet part not found: {part or '(missing relationship)'}"],
            "cells": [],
            "cellCount": 0,
            "formattedCellCount": 0,
            "dimension": "",
            "mergedRanges": [],
            "hiddenRows": [],
            "hiddenColumns": [],
            "dataValidations": [],
        }
    sheet_rels = read_rels(zf, part)
    comments = parse_comments(zf, part, sheet_rels)
    hyperlinks = parse_hyperlinks(root, sheet_rels)
    dimension_node = root.find(q("dimension"))
    dimension = dimension_node.attrib.get("ref", "") if dimension_node is not None else ""
    hidden_rows: list[str] = []
    cells: list[dict[str, Any]] = []
    formatted_count = 0
    for row in root.findall(f".//{q('sheetData')}/{q('row')}"):
        row_ref = row.attrib.get("r", "")
        if row.attrib.get("hidden") in {"1", "true", "TRUE"} and row_ref:
            hidden_rows.append(row_ref)
        for cell in row.findall(q("c")):
            ref = cell.attrib.get("r", "")
            if not ref:
                continue
            col, row_number = cell_ref_parts(ref)
            formula = text_content(cell.find(q("f")))
            value = parse_cell_value(cell, shared_strings)
            style = style_for(styles, cell.attrib.get("s"))
            summary = style_summary(style)
            comment = comments.get(ref)
            hyperlink = hyperlinks.get(ref)
            include = bool(value or formula or comment or hyperlink or style_signal(style))
            if not include:
                continue
            if summary:
                formatted_count += 1
            entry: dict[str, Any] = {
                "cell": ref,
                "row": row_number,
                "column": col,
                "columnIndex": column_to_number(col),
                "value": value,
                "formula": formula,
                "formatting": summary,
                "style": style,
            }
            if comment:
                entry["comment"] = comment
            if hyperlink:
                entry["hyperlink"] = hyperlink
            cells.append(entry)

    fill_palette = sorted({
        (cell.get("style", {}).get("fill", {}).get("fgColor") or {}).get("hex", "")
        for cell in cells
        if (cell.get("style", {}).get("fill", {}).get("fgColor") or {}).get("hex")
    })
    return {
        "name": sheet_info["name"],
        "sheetIndex": index,
        "sheetId": sheet_info.get("sheetId", ""),
        "state": sheet_info.get("state", "visible"),
        "part": part,
        "dimension": dimension,
        "mergedRanges": parse_merges(root),
        "hiddenRows": hidden_rows,
        "hiddenColumns": parse_hidden_columns(root),
        "dataValidations": parse_data_validations(root),
        "fillPalette": fill_palette,
        "cells": cells,
        "cellCount": len(cells),
        "formattedCellCount": formatted_count,
        "warnings": [],
    }


def rel_path(path_value: str, root: str) -> str:
    try:
        return os.path.relpath(path_value, root).replace(os.sep, "/")
    except ValueError:
        return path_value.replace(os.sep, "/")


def write_sheet_markdown(sheet: dict[str, Any], output_path: str) -> None:
    with open(output_path, "w", encoding="utf-8") as fh:
        fh.write(f"# Sheet: {sheet['name']}\n\n")
        fh.write("Formatting is preserved as source evidence. Do not infer a color legend unless the workbook itself defines one.\n\n")
        fh.write("## Sheet Metadata\n\n")
        for label, key in [
            ("Sheet index", "sheetIndex"),
            ("Sheet id", "sheetId"),
            ("Visibility", "state"),
            ("Dimension", "dimension"),
            ("Parsed cells", "cellCount"),
            ("Formatted cells", "formattedCellCount"),
        ]:
            fh.write(f"- {label}: {md_escape(sheet.get(key, ''))}\n")
        if sheet.get("fillPalette"):
            fh.write(f"- Fill colors seen: {', '.join(md_escape(item) for item in sheet['fillPalette'])}\n")
        if sheet.get("mergedRanges"):
            fh.write(f"- Merged ranges: {', '.join(md_escape(item) for item in sheet['mergedRanges'])}\n")
        if sheet.get("hiddenRows"):
            fh.write(f"- Hidden rows: {', '.join(md_escape(item) for item in sheet['hiddenRows'])}\n")
        if sheet.get("hiddenColumns"):
            columns = [f"{item.get('min', '')}-{item.get('max', '')}" for item in sheet["hiddenColumns"]]
            fh.write(f"- Hidden columns: {', '.join(md_escape(item) for item in columns)}\n")
        fh.write("\n")

        if sheet.get("dataValidations"):
            fh.write("## Data Validations\n\n")
            fh.write("| Range | Type | Operator | Formula 1 | Formula 2 |\n")
            fh.write("|---|---|---|---|---|\n")
            for item in sheet["dataValidations"]:
                fh.write(
                    f"| {md_escape(item.get('sqref'))} | {md_escape(item.get('type'))} | "
                    f"{md_escape(item.get('operator'))} | {md_escape(item.get('formula1'))} | {md_escape(item.get('formula2'))} |\n"
                )
            fh.write("\n")

        fh.write("## Cells\n\n")
        fh.write("| Cell | Value | Formula | Formatting | Notes |\n")
        fh.write("|---|---|---|---|---|\n")
        if not sheet.get("cells"):
            fh.write("|  |  |  |  | No parsed cells. |\n")
        for cell in sheet.get("cells", []):
            notes: list[str] = []
            if cell.get("comment"):
                comment = cell["comment"]
                author = comment.get("author", "")
                text = comment.get("text", "")
                notes.append(f"comment{f' by {author}' if author else ''}: {text}")
            if cell.get("hyperlink"):
                link = cell["hyperlink"]
                notes.append(f"link: {link.get('target', '')}")
            fh.write(
                f"| {md_escape(cell.get('cell'))} | {md_escape(cell.get('value'))} | "
                f"{md_escape(cell.get('formula'))} | {md_escape(cell.get('formatting'))} | {md_escape('; '.join(notes))} |\n"
            )


def write_index(trace: dict[str, Any], index_path: str, output_root: str) -> None:
    with open(index_path, "w", encoding="utf-8") as fh:
        fh.write("# Spec Beanstalk API Workbook\n\n")
        fh.write("This spec was generated from an `.xlsx` workbook by the Kronos Python analyzer. Cell formatting is source evidence, not decoration.\n\n")
        fh.write("## Source\n\n")
        fh.write(f"- Workbook: {md_escape(trace['sourceWorkbook'])}\n")
        fh.write(f"- Workbook SHA-256: `{trace['sourceWorkbookSha256']}`\n")
        fh.write(f"- Generated at: {md_escape(trace['generatedAt'])}\n")
        fh.write(f"- Trace file: `{md_escape(trace['output']['tracePath'])}`\n\n")
        fh.write("## Implementation Rules\n\n")
        fh.write("- Cite the Markdown section and original Excel sheet/cell/range when implementing behavior.\n")
        fh.write("- Do not infer a color legend. If a color, merged section, or note appears meaningful but no workbook legend defines it, call it out instead of inventing a rule.\n")
        fh.write("- Treat formulas, comments, dropdowns, hidden rows/columns, and merged ranges as requirements evidence.\n")
        fh.write("- Keep Java code, tests, and generated spec notes traceable to this index and the JSON trace.\n\n")
        fh.write("## Sheets\n\n")
        fh.write("| Sheet | Visibility | Cells | Formatted | Colors | Markdown |\n")
        fh.write("|---|---:|---:|---:|---|---|\n")
        for sheet in trace["sheets"]:
            colors = ", ".join(sheet.get("fillPalette", []))
            sheet_path = sheet.get("markdownPath", "")
            rel_sheet_path = rel_path(os.path.join(output_root, sheet_path), os.path.dirname(index_path)) if sheet_path else ""
            fh.write(
                f"| {md_escape(sheet['name'])} | {md_escape(sheet.get('state'))} | {sheet.get('cellCount', 0)} | "
                f"{sheet.get('formattedCellCount', 0)} | {md_escape(colors)} | [{md_escape(sheet['name'])}]({md_escape(rel_sheet_path)}) |\n"
            )


def convert(workbook_path: str, output_dir: str, repo_root: str) -> dict[str, Any]:
    if not workbook_path.lower().endswith(".xlsx"):
        raise ValueError("Spec Beanstalk currently supports .xlsx workbooks only.")
    if not zipfile.is_zipfile(workbook_path):
        raise ValueError("Input is not a valid .xlsx zip package.")
    os.makedirs(output_dir, exist_ok=True)
    sheets_dir = os.path.join(output_dir, "sheets")
    os.makedirs(sheets_dir, exist_ok=True)

    generated_at = now_utc()
    with zipfile.ZipFile(workbook_path, "r") as zf:
        sheet_infos, workbook_rels = workbook_sheets(zf)
        shared_strings = read_shared_strings(zf, workbook_rels)
        styles = parse_styles(zf, workbook_rels)
        sheets = [
            parse_sheet(zf, sheet_info, index, shared_strings, styles)
            for index, sheet_info in enumerate(sheet_infos, start=1)
        ]

    used_stems: set[str] = set()
    for sheet in sheets:
        stem = safe_file_stem(sheet["name"])
        if stem in used_stems:
            stem = f"{stem}-{sheet['sheetIndex']}"
        used_stems.add(stem)
        file_path = os.path.join(sheets_dir, f"{stem}.md")
        write_sheet_markdown(sheet, file_path)
        sheet["markdownPath"] = rel_path(file_path, output_dir)

    index_path = os.path.join(output_dir, "spec-beanstalk.md")
    trace_path = os.path.join(output_dir, "spec-beanstalk-trace.json")
    summary_path = os.path.join(output_dir, "spec-beanstalk-summary.json")
    trace = {
        "schema": "kronos.spec-beanstalk.v1",
        "generatedAt": generated_at,
        "sourceWorkbook": os.path.basename(workbook_path),
        "sourceWorkbookSha256": file_sha256(workbook_path),
        "output": {
            "outputDir": rel_path(output_dir, repo_root),
            "indexPath": rel_path(index_path, repo_root),
            "tracePath": rel_path(trace_path, repo_root),
            "summaryPath": rel_path(summary_path, repo_root),
        },
        "sheets": sheets,
    }
    write_index(trace, index_path, output_dir)
    with open(trace_path, "w", encoding="utf-8") as fh:
        json.dump(trace, fh, indent=2, sort_keys=True, ensure_ascii=False)
        fh.write("\n")

    summary = {
        "schema": trace["schema"],
        "generatedAt": generated_at,
        "sourceWorkbook": trace["sourceWorkbook"],
        "sourceWorkbookSha256": trace["sourceWorkbookSha256"],
        "outputDir": rel_path(output_dir, repo_root),
        "indexPath": rel_path(index_path, repo_root),
        "tracePath": rel_path(trace_path, repo_root),
        "summaryPath": rel_path(summary_path, repo_root),
        "sheetCount": len(sheets),
        "cellCount": sum(sheet.get("cellCount", 0) for sheet in sheets),
        "formattedCellCount": sum(sheet.get("formattedCellCount", 0) for sheet in sheets),
        "sheets": [
            {
                "name": sheet["name"],
                "state": sheet.get("state", ""),
                "cellCount": sheet.get("cellCount", 0),
                "formattedCellCount": sheet.get("formattedCellCount", 0),
                "fillPalette": sheet.get("fillPalette", []),
                "markdownPath": sheet.get("markdownPath", ""),
                "warnings": sheet.get("warnings", []),
            }
            for sheet in sheets
        ],
    }
    with open(summary_path, "w", encoding="utf-8") as fh:
        json.dump(summary, fh, indent=2, sort_keys=True, ensure_ascii=False)
        fh.write("\n")
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate Kronos Spec Beanstalk Markdown from .xlsx.")
    parser.add_argument("--workbook", required=True, help="Path to the .xlsx workbook.")
    parser.add_argument("--output", required=True, help="Output directory, normally <java repo>/docs/api-spec.")
    parser.add_argument("--repo", required=True, help="Java repository root used for relative artifact paths.")
    args = parser.parse_args()

    try:
        summary = convert(os.path.abspath(args.workbook), os.path.abspath(args.output), os.path.abspath(args.repo))
    except Exception as exc:  # noqa: BLE001 - CLI boundary should show concise error text.
        print(f"Spec Beanstalk generation failed: {exc}", file=sys.stderr)
        return 1

    print(json.dumps(summary, sort_keys=True, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
