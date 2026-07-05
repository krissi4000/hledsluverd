import type { Scraper } from './types';
import { isorkaScraper } from './isorka';
import { n1Scraper } from './n1';
import { onScraper } from './on';

export const allScrapers: Scraper[] = [onScraper, isorkaScraper, n1Scraper];
