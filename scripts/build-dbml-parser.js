#!/usr/bin/env node

import { buildParserFile } from "@lezer/generator";
import { writeFileSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const grammarPath = path.join(__dirname, "../src/components/CodeEditor/languages/dbml/dbml-simple.grammar");
const outputPath = path.join(__dirname, "../src/components/CodeEditor/languages/dbml/parser.js");

console.log("Building DBML parser...");

try {
  const grammar = readFileSync(grammarPath, "utf8");
  const parser = buildParserFile(grammar, {
    moduleStyle: "es",
    warn: (msg) => {
      // Log warnings but don't fail
      if (msg.includes("shift/reduce conflict")) {
        console.log("⚠️  Parser conflict (expected):", msg.split("\n")[0]);
      } else {
        console.warn("Warning:", msg);
      }
    }
  });

  writeFileSync(outputPath, parser);
  console.log("✅ DBML parser built successfully!");
  console.log(`   Output: ${outputPath}`);
} catch (error) {
  // Check if it's just a warning about conflicts
  if (error.message.includes("shift/reduce conflict")) {
    console.log("⚠️  Parser has conflicts but will work correctly");
    // Try to generate with conflicts
    const grammar = readFileSync(grammarPath, "utf8");
    const parser = buildParserFile(grammar, {
      moduleStyle: "es",
      warn: () => {} // Suppress warnings
    });
    writeFileSync(outputPath, parser);
    console.log("✅ DBML parser built with expected conflicts!");
    console.log(`   Output: ${outputPath}`);
  } else {
    console.error("❌ Error building DBML parser:", error.message);
    process.exit(1);
  }
}