import { vi } from "vitest";

// Minimal Express-like response double: records status, JSON body and headers
export const mockRes = () => {
  const res = { statusCode: 200, body: undefined, headers: {} };
  res.status = vi.fn((code) => {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn((body) => {
    res.body = body;
    return res;
  });
  res.setHeader = vi.fn((name, value) => {
    res.headers[name] = value;
  });
  return res;
};
