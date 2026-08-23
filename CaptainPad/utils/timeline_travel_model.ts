export function shiftTimelineLocalTime(value: string, deltaMinutes: number): string {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid Timeline local time: ${value}`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`Invalid Timeline local time: ${value}`);
  }
  const dayMinutes = 24 * 60;
  const shifted = ((((hour * 60) + minute + deltaMinutes) % dayMinutes) + dayMinutes) % dayMinutes;
  return `${String(Math.floor(shifted / 60)).padStart(2, '0')}:${String(shifted % 60).padStart(2, '0')}`;
}

export function roundTimelineLocalTime(date: Date, stepMinutes = 15): string {
  if (!Number.isInteger(stepMinutes) || stepMinutes <= 0 || stepMinutes > 60) {
    throw new Error('Timeline time step must be an integer from 1 to 60 minutes');
  }
  const minutes = (date.getHours() * 60) + date.getMinutes();
  const rounded = Math.round(minutes / stepMinutes) * stepMinutes;
  const normalized = rounded % (24 * 60);
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}
