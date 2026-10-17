import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LinkButton } from "./link-button";

describe("LinkButton", () => {
  it("renderiza um link (<a>) com a aparência de botão, e nunca um <button> aninhado em link", () => {
    const out = renderToStaticMarkup(<LinkButton href="/blueprints?o=x1" variant="outline">Montar blueprint</LinkButton>);
    expect(out).toMatch(/^<a /);
    expect(out).toContain('href="/blueprints?o=x1"');
    expect(out).not.toContain("<button");
    expect(out).toContain("Montar blueprint");
  });
});
