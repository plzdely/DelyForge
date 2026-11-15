import { createPublicKey, verify } from 'node:crypto';
import {
  type BotModules,
  type Builders,
  type ListingDetail,
  type ListingSummary,
  type ListingType,
  type MyListing,
  type PackageContent,
  type PackagePayload,
  type ReviewQueueItem,
  type SignedPackage,
  base64UrlDecode,
  packageSigningInput,
  validatePackage,
} from '@delyforge/shared';
import type { AccountService } from './account';
import { AppError } from './errors';
import type { BuildersService } from './runtime/builders-service';

/** Checks DelyForge's signature, then re-validates the content. Returns null for anything that doesn't pass. */
export function verifyPackage(pkg: SignedPackage, publicKeyPem: string): PackagePayload | null {
  try {
    const ok = verify(null, Buffer.from(packageSigningInput(pkg.payload)), createPublicKey(publicKeyPem), Buffer.from(base64UrlDecode(pkg.signature)));
    if (!ok) return null;
    const parsed = JSON.parse(pkg.payload) as PackagePayload;
    const checked = validatePackage(parsed.content);
    return checked.ok && typeof parsed.slug === 'string' ? { ...parsed, content: checked.content } : null;
  } catch {
    return null;
  }
}

type Api = Pick<AccountService, 'authed' | 'publicGet' | 'publicKey'>;
const enc = encodeURIComponent;

/** The app's side of the marketplace: browsing, installing signed packs, reviews and publishing. */
export class MarketplaceClient {
  constructor(
    private readonly api: Api,
    private readonly builders: Pick<BuildersService, 'get' | 'installContent'>,
  ) {}

  list(filter: { type?: ListingType; q?: string; sort?: 'popular' | 'rating' | 'new' }): Promise<ListingSummary[]> {
    const query = new URLSearchParams(Object.entries(filter).filter(([, v]) => v) as [string, string][]).toString();
    return this.api.publicGet(`/v1/marketplace/listings${query ? `?${query}` : ''}`);
  }

  detail(slug: string): Promise<ListingDetail> {
    return this.api.publicGet(`/v1/marketplace/listings/${enc(slug)}`);
  }

  async install(slug: string, botId: string, guildId: string): Promise<{ modules: BotModules; builders: Builders }> {
    const signed = await this.api.authed<SignedPackage>('POST', `/v1/marketplace/listings/${enc(slug)}/install`);
    const pkg = verifyPackage(signed, await this.api.publicKey());
    if (!pkg || pkg.slug !== slug) throw new AppError('INTERNAL', 'This package failed DelyForge’s signature check, so it was not installed.');
    return this.builders.installContent(botId, guildId, pkg.content, `“${pkg.title}” ${pkg.version} from the marketplace`);
  }

  review(slug: string, rating: number, body: string): Promise<null> {
    return this.api.authed('POST', `/v1/marketplace/listings/${enc(slug)}/reviews`, { rating, body });
  }

  developer(): Promise<{ displayName: string; slug: string } | null> {
    return this.api.authed('GET', '/v1/marketplace/developer');
  }

  becomeDeveloper(input: { displayName: string; slug: string }): Promise<{ displayName: string; slug: string }> {
    return this.api.authed('POST', '/v1/marketplace/developer', input);
  }

  mine(): Promise<MyListing[]> {
    return this.api.authed('GET', '/v1/marketplace/developer/listings');
  }

  /**
   * Packages the chosen commands and embeds of a bot (plus any embed a chosen command uses) and submits them for
   * review. Modules and workflows aren't offered here because they point at a server's own channels and roles.
   */
  submit(input: {
    id: string;
    commandIds: string[];
    embedIds: string[];
    listing: { slug: string; title: string; summary: string; description: string; category: string; tags: string[]; version: string; changelog: string };
  }): Promise<MyListing> {
    const b = this.builders.get(input.id);
    const commands = b.commands.filter((c) => input.commandIds.includes(c.id));
    const wanted = new Set([...input.embedIds, ...commands.map((c) => c.response.embedId).filter(Boolean)]);
    const content: PackageContent = { modules: {}, commands, embeds: b.embeds.filter((e) => wanted.has(e.id)), workflows: [] };
    if (!commands.length && !content.embeds.length) throw new AppError('VALIDATION_FAILED', 'Choose at least one command or embed.');
    // Commands that bring their own embeds are still a command pack; commands plus separately chosen embeds are a template.
    const type = commands.length && input.embedIds.length ? 'TEMPLATE' : commands.length ? 'COMMAND_PACK' : 'EMBED_PACK';
    return this.api.authed('POST', '/v1/marketplace/developer/listings', { ...input.listing, type, content });
  }

  queue(): Promise<ReviewQueueItem[]> {
    return this.api.authed('GET', '/v1/marketplace/review-queue');
  }

  moderate(versionId: string, approve: boolean, notes: string): Promise<null> {
    return this.api.authed('POST', `/v1/marketplace/review-queue/${enc(versionId)}`, { approve, notes });
  }
}
