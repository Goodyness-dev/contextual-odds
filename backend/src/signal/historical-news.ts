import { fullMatchCommentary } from './full-commentary';

export function getHistoricalNews(matchMinute: number): string {
  // Pull the precise commentary for the exact match minute
  return fullMatchCommentary[matchMinute] || "No updates available at this minute.";
}
