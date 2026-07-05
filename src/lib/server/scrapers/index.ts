import type { Scraper } from './types';
import { onScraper } from './on';

export const allScrapers: Scraper[] = [onScraper];
