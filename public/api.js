// Fetch wrapper for the JSON API. Throws Error with the server's Vietnamese message.

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new CustomEvent('awp:unauthorized'));
    throw new ApiError(res.status, data.error || `Lỗi ${res.status}`, data.details);
  }
  return data;
}

export const get = (url) => api('GET', url);
export const put = (url, body) => api('PUT', url, body);
export const post = (url, body) => api('POST', url, body || {});
export const del = (url, body) => api('DELETE', url, body);
