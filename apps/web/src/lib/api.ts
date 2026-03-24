const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8787";

interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
}

class ApiClient {
  private token: string | null = null;

  setToken(token: string | null) {
    this.token = token;
    if (token) {
      localStorage.setItem("mg_token", token);
    } else {
      localStorage.removeItem("mg_token");
    }
  }

  getToken(): string | null {
    if (this.token) return this.token;
    if (typeof window !== "undefined") {
      this.token = localStorage.getItem("mg_token");
    }
    return this.token;
  }

  async request<T = unknown>(
    path: string,
    opts: RequestOptions = {},
  ): Promise<T> {
    const { body, headers: extraHeaders, ...rest } = opts;
    const headers: Record<string, string> = {
      ...(extraHeaders as Record<string, string>),
    };

    const token = this.getToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    if (body && !(body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
    }

    const res = await fetch(`${API_BASE}${path}`, {
      ...rest,
      headers,
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401) {
      this.setToken(null);
      if (typeof window !== "undefined") {
        window.location.href = "/login";
      }
      throw new Error("Unauthorized");
    }

    const data = await res.json();

    if (!res.ok) {
      throw new Error((data as any).error || `Request failed: ${res.status}`);
    }

    return data as T;
  }

  get<T = unknown>(path: string) {
    return this.request<T>(path);
  }

  post<T = unknown>(path: string, body?: unknown) {
    return this.request<T>(path, { method: "POST", body });
  }

  put<T = unknown>(path: string, body?: unknown) {
    return this.request<T>(path, { method: "PUT", body });
  }

  delete<T = unknown>(path: string) {
    return this.request<T>(path, { method: "DELETE" });
  }

  upload<T = unknown>(path: string, formData: FormData) {
    return this.request<T>(path, { method: "POST", body: formData });
  }
}

export const api = new ApiClient();
