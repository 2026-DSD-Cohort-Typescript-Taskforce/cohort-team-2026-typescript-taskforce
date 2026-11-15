// .env.example leaves MAILPIT_URL blank to use the local default.
export function mailpitUrl(value: string | undefined): string {
  return value?.trim() || 'http://127.0.0.1:54324';
}
