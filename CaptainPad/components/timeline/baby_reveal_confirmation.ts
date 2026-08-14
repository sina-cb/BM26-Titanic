export interface BabyRevealConfirmation {
  color: 'PINK' | 'BLUE';
  title: string;
  body: string;
  confirmLabel: string;
}

export function babyRevealConfirmation(cueId: string): BabyRevealConfirmation | null {
  let color: BabyRevealConfirmation['color'];
  if (cueId === 'c_baby_reveal_pink') color = 'PINK';
  else if (cueId === 'c_baby_reveal_blue') color = 'BLUE';
  else return null;
  return {
    color,
    title: `FIRE ${color} BABY REVEAL?`,
    body: `This immediately starts the ${color} reveal at time zero. The answer appears after the 90-second tease and 2-second blackout.`,
    confirmLabel: `FIRE ${color}`,
  };
}
