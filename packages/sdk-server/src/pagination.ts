import { OtpApiError } from "@k-otp/sdk-core";

/** One page of a keyset-paginated list endpoint. */
export type OtpPage<TItem> = { items: TItem[]; nextCursor?: string };

export type PaginateOptions = {
  /** Stop after this many pages (safety valve). Default: unlimited. */
  maxPages?: number;
};

/**
 * Iterates pages of a cursor-paginated endpoint, passing each `nextCursor`
 * back unchanged as `cursor` and keeping every other filter the same.
 */
export async function* paginatePages<
  TItem,
  TInput extends { cursor?: string | undefined },
>(
  fetchPage: (input: TInput) => Promise<OtpPage<TItem>>,
  input: TInput,
  options: PaginateOptions = {},
): AsyncGenerator<OtpPage<TItem>, void, undefined> {
  const seen = new Set<string>();
  let cursor = input.cursor;
  for (
    let page = 0;
    options.maxPages === undefined || page < options.maxPages;
    page++
  ) {
    const result = await fetchPage(
      cursor === undefined ? input : { ...input, cursor },
    );
    yield result;
    const next = result.nextCursor;
    if (!next) return;
    if (seen.has(next)) {
      throw new OtpApiError({
        code: "UNKNOWN",
        status: 0,
        message: "Pagination cursor did not advance; stopping to avoid a loop",
      });
    }
    seen.add(next);
    cursor = next;
  }
}

/** Like {@link paginatePages}, but yields individual items. */
export async function* paginate<
  TItem,
  TInput extends { cursor?: string | undefined },
>(
  fetchPage: (input: TInput) => Promise<OtpPage<TItem>>,
  input: TInput,
  options: PaginateOptions = {},
): AsyncGenerator<TItem, void, undefined> {
  for await (const page of paginatePages(fetchPage, input, options)) {
    yield* page.items;
  }
}
