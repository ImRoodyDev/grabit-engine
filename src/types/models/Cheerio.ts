import type * as cheerio from "cheerio";
import type { ScrapeRequester } from "../input/Requester.ts";
import type { Response } from "../../services/fetcher.ts";

export type CheerioLoadRequest = ScrapeRequester & {
	extraHeaders?: { [key: string]: string };
	followRedirects?: boolean;
};
export type CheerioLoadResult = Readonly<{
	$: cheerio.CheerioAPI;
	response: Response;
}>;
