import { describe, it, expect } from "vitest";
import { AppError, notFound, forbidden, badRequest, conflict } from "./errors";

describe("AppError", () => {
  it("creates error with status code and message", () => {
    const err = new AppError(400, "Bad input", "BAD_INPUT");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe("Bad input");
    expect(err.code).toBe("BAD_INPUT");
    expect(err.name).toBe("AppError");
  });

  it("code is optional", () => {
    const err = new AppError(500, "Oops");
    expect(err.code).toBeUndefined();
  });
});

describe("error factory functions", () => {
  it("notFound defaults to 'Resource not found'", () => {
    const err = notFound();
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe("Resource not found");
    expect(err.code).toBe("NOT_FOUND");
  });

  it("notFound accepts custom resource name", () => {
    const err = notFound("Loan");
    expect(err.message).toBe("Loan not found");
  });

  it("forbidden defaults to 'Insufficient permissions'", () => {
    const err = forbidden();
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe("FORBIDDEN");
  });

  it("badRequest creates 400 error", () => {
    const err = badRequest("Missing field");
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe("Missing field");
    expect(err.code).toBe("BAD_REQUEST");
  });

  it("conflict creates 409 error", () => {
    const err = conflict("Already exists");
    expect(err.statusCode).toBe(409);
    expect(err.message).toBe("Already exists");
    expect(err.code).toBe("CONFLICT");
  });
});
