import { describe, it, expect, vi, beforeEach } from "vitest";

// Replace the Gemini SDK: every test decides what the model "returns"
const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    constructor() {
      this.models = { generateContent };
    }
  },
}));

const { default: analyzeTicket } = await import("../utils/ai.js");

const ticket = { title: "Login page blank", description: "React app shows a white screen after login" };

const valid = {
  summary: "Login page renders blank",
  priority: "high",
  helpfulNotes: "Check the auth context and console errors.",
  relatedSkills: ["React", "JWT"],
};

const FALLBACK = {
  summary: "Unable to process ticket automatically",
  priority: "MEDIUM",
  helpfulNotes: "Manual review required. AI parsing failed.",
  relatedSkills: ["Manual Review"],
};

const modelReturns = (text) => generateContent.mockResolvedValueOnce({ text });

describe("analyzeTicket", () => {
  beforeEach(() => generateContent.mockReset());

  it("parses a clean JSON response", async () => {
    modelReturns(JSON.stringify(valid));
    await expect(analyzeTicket(ticket)).resolves.toEqual(valid);
  });

  it("sends the ticket to Gemini in JSON mode", async () => {
    modelReturns(JSON.stringify(valid));
    await analyzeTicket(ticket);

    const request = generateContent.mock.calls[0][0];
    expect(request.config.responseMimeType).toBe("application/json");
    expect(request.contents[0].parts[0].text).toContain(ticket.title);
    expect(request.contents[0].parts[0].text).toContain(ticket.description);
  });

  it("extracts JSON wrapped in markdown code fences", async () => {
    modelReturns("```json\n" + JSON.stringify(valid) + "\n```");
    await expect(analyzeTicket(ticket)).resolves.toEqual(valid);
  });

  it("ignores chatter around the JSON object", async () => {
    modelReturns(`Sure! Here is the analysis: ${JSON.stringify(valid)} Hope this helps.`);
    await expect(analyzeTicket(ticket)).resolves.toEqual(valid);
  });

  it("replaces an unknown priority with MEDIUM", async () => {
    modelReturns(JSON.stringify({ ...valid, priority: "URGENT" }));
    const result = await analyzeTicket(ticket);
    expect(result.priority).toBe("MEDIUM");
  });

  it("wraps a single skill string into an array", async () => {
    modelReturns(JSON.stringify({ ...valid, relatedSkills: "React" }));
    const result = await analyzeTicket(ticket);
    expect(result.relatedSkills).toEqual(["React"]);
  });

  it("returns the fallback object for invalid JSON", async () => {
    modelReturns("this is not json at all");
    await expect(analyzeTicket(ticket)).resolves.toEqual(FALLBACK);
  });

  it("returns the fallback object when the Gemini call fails", async () => {
    generateContent.mockRejectedValueOnce(new Error("429 Too Many Requests"));
    await expect(analyzeTicket(ticket)).resolves.toEqual(FALLBACK);
  });

  it("returns null when the model returns no text", async () => {
    modelReturns(undefined);
    await expect(analyzeTicket(ticket)).resolves.toBeNull();
  });
});
