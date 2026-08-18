import { describe, expect, it, vi } from "vitest";

vi.mock("../src/db/repositories/services.js", () => ({
  listActiveServices: vi.fn().mockResolvedValue([
    {
      id: "microblading",
      category_id: "cejas",
      booking_group: "Principales",
      name: "Microblading",
      duration: "2h",
      duration_minutes: 120,
      price: "250",
      deposit_amount: 50,
      description: "Técnica de trazos finos.",
      active: true,
    },
    {
      id: "henna",
      category_id: "cejas",
      booking_group: "Opcionales",
      name: "Henna",
      duration: "30min",
      duration_minutes: 30,
      price: "40",
      deposit_amount: null,
      description: "Diseño de cejas con tinte natural.",
      active: true,
    },
  ]),
}));

const { buildSystemPrompt } = await import("../src/agent/systemPrompt.js");

describe("buildSystemPrompt", () => {
  it("incluye el catálogo real, agrupado por booking_group", async () => {
    const prompt = await buildSystemPrompt();
    expect(prompt).toContain("Microblading");
    expect(prompt).toContain("id: microblading");
    expect(prompt).toContain("S/ 250");
    expect(prompt).toContain("adelanto S/ 50");
    expect(prompt).toContain("Henna");
    expect(prompt).toContain("Principales:");
    expect(prompt).toContain("Opcionales:");
  });

  it("no incluye adelanto para servicios sin deposit_amount", async () => {
    const prompt = await buildSystemPrompt();
    const hennaLine = prompt.split("\n").find((l) => l.includes("Henna"));
    expect(hennaLine).not.toContain("adelanto");
  });

  it("incluye horario, dirección y política de cancelación reales", async () => {
    const prompt = await buildSystemPrompt();
    expect(prompt).toContain("8:00am–12:00pm");
    expect(prompt).toContain("Domingo cerrado");
    expect(prompt).toContain("30 minutos de antelación");
    expect(prompt).toContain("Av. José Santos Chocano 1330");
  });

  it("incluye la regla dura de no inventar disponibilidad/precios", async () => {
    const prompt = await buildSystemPrompt();
    expect(prompt.toLowerCase()).toContain("nunca inventes");
  });

  it("instruye escalar ante preguntas de salud y pedidos de hablar con una persona", async () => {
    const prompt = await buildSystemPrompt();
    expect(prompt).toContain("escalar_a_humano");
    expect(prompt.toLowerCase()).toContain("salud");
  });
});
