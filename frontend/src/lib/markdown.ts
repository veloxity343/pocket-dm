// A small Markdown renderer. Input is HTML-escaped before any markup is added,
// and dice notation ("2d6+3", "+5 to hit") becomes clickable roll buttons.

const esc = (s: string) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const DICE_RE = /(^|[^\w/])((?:\d{1,3})?d(?:\d{1,3}|%)(?:\s?[+−-]\s?\d{1,3}(?!\s?d\d))?)(?![\w])/g;
const TO_HIT_RE = /(^|[^\w])([+-]\d{1,2}) to hit/g;

function diceify(text: string) {
  // Stash "+5 to hit" buttons first so the dice pass can't match inside their attributes.
  const held: string[] = [];
  const hold = (html: string) => `\u0001${held.push(html) - 1}\u0001`;
  return text
    .replace(TO_HIT_RE, (_, pre, bonus) =>
      `${pre}${hold(`<button type="button" class="dice-link" data-roll="d20${bonus}" title="Roll d20${bonus}">${bonus}</button>`)} to hit`)
    .replace(DICE_RE, (_, pre, expr: string) => {
      const clean = expr.replace(/\s/g, "").replace("−", "-");
      return `${pre}<button type="button" class="dice-link" data-roll="${clean}" title="Roll ${clean}">${expr}</button>`;
    })
    .replace(/\u0001(\d+)\u0001/g, (_, i) => held[Number(i)]);
}

export interface MarkdownOptions {
  dice?: boolean;
}

function inline(text: string, { dice = true }: MarkdownOptions = {}) {
  let s = esc(text);
  const codes: string[] = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });
  if (dice) s = diceify(s);
  s = s
    .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, "$1<em>$2</em>")
    .replace(/(^|\W)_(?!\s)(.+?)_(?!\w)/g, "$1<em>$2</em>")
    .replace(/~~(.+?)~~/g, "<del>$1</del>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/ {2}$/g, "<br>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
}

const LIST_RE = /^\s*([-*+]|\d+\.)\s+/;

export function markdown(src: string, opts: MarkdownOptions = {}): string {
  const lines = String(src || "").replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  const isTableSep = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
  const cells = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      const lvl = Math.min(6, m[1].length + 1); // page title is h1/h2 already
      out.push(`<h${lvl}>${inline(m[2], opts)}</h${lvl}>`);
      i++;
    } else if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      out.push("<hr>");
      i++;
    } else if (/^```/.test(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(esc(lines[i++]));
      i++;
      out.push(`<pre><code>${buf.join("\n")}</code></pre>`);
    } else if (line.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = cells(line);
      const aligns = cells(lines[i + 1]).map((c) =>
        c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : "");
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]));
      const td = (tag: string, c: string, j: number) =>
        `<${tag}${aligns[j] ? ` style="text-align:${aligns[j]}"` : ""}>${inline(c, opts)}</${tag}>`;
      out.push(
        `<div class="table-wrap"><table><thead><tr>${head.map((c, j) => td("th", c, j)).join("")}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((c, j) => td("td", c, j)).join("")}</tr>`)
          .join("")}</tbody></table></div>`,
      );
    } else if (LIST_RE.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && LIST_RE.test(lines[i])) {
        let item = lines[i].replace(LIST_RE, "");
        i++;
        while (i < lines.length && lines[i].trim() && /^\s{2,}\S/.test(lines[i]) && !LIST_RE.test(lines[i])) {
          item += " " + lines[i++].trim();
        }
        items.push(`<li>${inline(item, opts)}</li>`);
        // lists separated by single blank lines stay one list
        if (i + 1 < lines.length && !lines[i]?.trim() && LIST_RE.test(lines[i + 1])) i++;
      }
      out.push(ordered ? `<ol>${items.join("")}</ol>` : `<ul>${items.join("")}</ul>`);
    } else if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ""));
      out.push(`<blockquote>${markdown(buf.join("\n"), opts)}</blockquote>`);
    } else {
      const buf: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        !/^(#{1,6}\s|```|>\s?|\s*([-*+]|\d+\.)\s+)/.test(lines[i]) &&
        !(lines[i].includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1]))
      ) {
        buf.push(lines[i++]);
      }
      out.push(`<p>${buf.map((l) => inline(l, opts)).join("\n")}</p>`);
    }
  }
  return out.join("\n");
}
