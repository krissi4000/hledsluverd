import type { Scraper } from './types';
import { isorkaScraper } from './isorka';
import { onScraper } from './on';

export const allScrapers: Scraper[] = [onScraper, isorkaScraper];
