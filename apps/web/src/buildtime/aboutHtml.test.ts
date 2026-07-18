import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileAboutHtml } from "./aboutHtml.js";

const ABOUT_MD = fileURLToPath(new URL("../content/about.md", import.meta.url));

describe("compileAboutHtml", () => {
  it("compiles ordinary Markdown", () => {
    const html = compileAboutHtml("## Heading\n\nSome **bold** prose.\n");
    expect(html).toContain("<h2>Heading</h2>");
    expect(html).toContain("<strong>bold</strong>");
  });

  it("strips HTML comments so the authoring note never ships", () => {
    const html = compileAboutHtml("<!-- a note to the author -->\n\n## Heading\n");
    expect(html).not.toContain("note to the author");
    expect(html).not.toContain("<!--");
  });

  describe("heading order", () => {
    it("rejects a top-level heading (the page renders the only <h1>)", () => {
      expect(() => compileAboutHtml("# Nope\n")).toThrow(/must start its headings at '##'/);
    });

    it("does not mistake a '#' inside a code fence for a heading", () => {
      expect(() => compileAboutHtml("## Fine\n\n```\n# not a heading\n```\n")).not.toThrow();
    });

    // The token scan walks only *top-level* tokens, so a nested heading reaches the
    // renderer and emits a real <h1>. Caught by the rendered-output backstop.
    it("rejects an h1 nested in a blockquote", () => {
      expect(() => compileAboutHtml("## ok\n\n> # sneaky\n")).toThrow(/produced an <h1>/);
    });

    it("rejects an h1 nested in a list item", () => {
      expect(() => compileAboutHtml("## ok\n\n- item\n\n  # deep\n")).toThrow(/produced an <h1>/);
    });
  });

  describe("external links", () => {
    it("opens in a new tab, safely, with the warning in the accessible name", () => {
      const html = compileAboutHtml("See [GitHub](https://github.com/fthiess/pbe-address-book).");
      expect(html).toContain('target="_blank"');
      expect(html).toContain('rel="noopener noreferrer"');
      expect(html).toContain('aria-label="GitHub (opens in a new tab)"');
      // The visible text is untouched — only the accessible name gains the warning.
      expect(html).toContain(">GitHub</a>");
    });

    it("leaves a relative link alone", () => {
      const html = compileAboutHtml("Back to the [Directory](/).");
      expect(html).toContain('<a href="/">Directory</a>');
      expect(html).not.toContain("target=");
    });

    // `//host/x` resolves off-origin but has no scheme, so an `https?:` test misses
    // it. Untreated it would also read as a root-relative path to AboutPage's click
    // delegation and be handed to the router — the `target` is what stops that.
    it("treats a protocol-relative link as external", () => {
      const html = compileAboutHtml("[x](//example.test/page)");
      expect(html).toContain('target="_blank"');
      expect(html).toContain('rel="noopener noreferrer"');
    });
  });

  describe("safety guards", () => {
    it("rejects a script tag", () => {
      expect(() => compileAboutHtml("## H\n\n<script>alert(1)</script>\n")).toThrow(/<script>/);
    });

    it("rejects an inline event handler", () => {
      expect(() => compileAboutHtml('## H\n\n<p onclick="steal()">hi</p>\n')).toThrow(
        /inline event handler/,
      );
    });

    it("rejects a javascript: URL", () => {
      expect(() => compileAboutHtml("[click](javascript:alert(1))")).toThrow(/javascript: URL/);
    });

    it("rejects an off-origin image (the production CSP would block it)", () => {
      expect(() => compileAboutHtml("![x](https://example.test/tracker.png)")).toThrow(
        /off-origin image or embed/,
      );
    });

    it("rejects a protocol-relative image (no scheme, still off-origin)", () => {
      expect(() => compileAboutHtml("![x](//example.test/tracker.png)")).toThrow(
        /off-origin image or embed/,
      );
    });

    it("allows a same-origin image", () => {
      expect(() => compileAboutHtml("![crest](/crest.svg)")).not.toThrow();
    });
  });

  describe("the shipped about.md", () => {
    const html = compileAboutHtml(readFileSync(ABOUT_MD, "utf8"));

    it("compiles and passes every guard", () => {
      expect(html).toContain("<h2>");
      expect(html).not.toContain("<h1>");
    });

    it("uses the N116 naming rule — never bare 'Book'", () => {
      // "PBE Address Book" and "the Address Book" are fine; a bare "Book" not
      // preceded by "Address" is what the rule forbids in member-facing copy.
      // Whitespace is collapsed first: the source wraps its lines, so "Address"
      // and "Book" are routinely separated by a newline rather than a space.
      expect(html.replace(/\s+/g, " ")).not.toMatch(/(?<!Address )\bBook\b/);
    });
  });
});
