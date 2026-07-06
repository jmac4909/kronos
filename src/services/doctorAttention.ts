export interface DoctorAttentionCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

export function doctorCheckNeedsAttention(check: DoctorAttentionCheck): boolean {
  return check.status !== 'pass';
}

export function doctorCheckAttentionId(check: DoctorAttentionCheck): string {
  return `integration:${check.name}`;
}

export function doctorCheckAttentionSeverity(check: DoctorAttentionCheck): 'critical' | 'warning' {
  return check.status === 'fail' ? 'critical' : 'warning';
}
