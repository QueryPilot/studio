import fs from "node:fs";
import path from "node:path";

const root = path.resolve(
  process.cwd(),
  "src/components/DataGrid/renderers",
);

const editorFiles = [];

const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }
    if (entry.isFile() && entry.name.includes("Editor") && entry.name.endsWith(".tsx")) {
      editorFiles.push(fullPath);
    }
  }
};

walk(root);

const issues = [];

const currentValuePattern = /(?:\.target\.value|\.current\??\.value)/;

const getLineNumber = (text, index) =>
  text.slice(0, index).split(/\r?\n/).length;

for (const file of editorFiles) {
  const text = fs.readFileSync(file, "utf8");

  const currentValueVars = new Set();
  const currentValueRefs = new Set();

  const varRegex = /\b(?:const|let)\s+([A-Za-z_]\w*)\s*=\s*([^;]+);/g;
  let match = null;
  while ((match = varRegex.exec(text))) {
    const name = match[1];
    const rhs = match[2];
    if (currentValuePattern.test(rhs)) {
      currentValueVars.add(name);
    }
  }

  const refAssignRegex = /\b([A-Za-z_]\w*)\.current\s*=\s*([^;]+);/g;
  while ((match = refAssignRegex.exec(text))) {
    const refName = match[1];
    const rhs = match[2].trim();
    if (currentValuePattern.test(rhs)) {
      currentValueRefs.add(refName);
      continue;
    }
    if (currentValueVars.has(rhs)) {
      currentValueRefs.add(refName);
    }
  }

  if (currentValueRefs.size === 0) continue;

  const hasChangedRegex = /\bhasChanged\b\s*=\s*([^;]+);/g;
  while ((match = hasChangedRegex.exec(text))) {
    const expr = match[1];
    if (!/!==|!=/.test(expr)) continue;

    const usesCurrentValueVar =
      currentValuePattern.test(expr) ||
      Array.from(currentValueVars).some((name) =>
        new RegExp(`\\b${name}\\b`).test(expr),
      );

    if (!usesCurrentValueVar) continue;

    const refMatches = [];
    const refRegex = /\b([A-Za-z_]\w*)\.current\b/g;
    let refMatch = null;
    while ((refMatch = refRegex.exec(expr))) {
      const refName = refMatch[1];
      if (currentValueRefs.has(refName)) {
        refMatches.push(refName);
      }
    }

    if (refMatches.length > 0) {
      issues.push({
        file,
        line: getLineNumber(text, match.index),
        expr: expr.trim(),
        refs: refMatches,
      });
    }
  }
}

if (issues.length > 0) {
  const rel = (filePath) => path.relative(process.cwd(), filePath);
  console.error(
    "Potential current-vs-current change detection in DataGrid editors:",
  );
  for (const issue of issues) {
    console.error(
      `- ${rel(issue.file)}:${issue.line} uses ${issue.refs.join(
        ", ",
      )}.current in: ${issue.expr}`,
    );
  }
  process.exitCode = 1;
} else {
  console.log("Editor change-detection check passed.");
}
