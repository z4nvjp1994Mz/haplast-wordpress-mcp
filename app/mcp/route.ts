import { createMcpHandler } from "mcp-handler";
import { z } from "zod";

const WP_URL = (process.env.WORDPRESS_URL || "").replace(/\/$/, "");
const WP_USER = process.env.WORDPRESS_USERNAME || "";
const WP_APP_PASSWORD = process.env.WORDPRESS_APP_PASSWORD || "";

function ensureConfig() {
  if (!WP_URL) throw new Error("Missing WORDPRESS_URL");
  if (!WP_USER) throw new Error("Missing WORDPRESS_USERNAME");
  if (!WP_APP_PASSWORD) throw new Error("Missing WORDPRESS_APP_PASSWORD");
}

function authHeader() {
  ensureConfig();
  const token = Buffer.from(`${WP_USER}:${WP_APP_PASSWORD}`).toString("base64");
  return `Basic ${token}`;
}

async function apiFetch(apiPath: string, init: RequestInit = {}) {
  ensureConfig();
  const url = `${WP_URL}/wp-json${apiPath}`;
  const headers = new Headers(init.headers);
  headers.set("Authorization", authHeader());
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(url, { ...init, headers, cache: "no-store" });
  const text = await res.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    const message =
      data?.message ||
      (typeof data === "string" ? data.slice(0, 500) : JSON.stringify(data));
    throw new Error(`WordPress API ${res.status}: ${message}`);
  }

  return { data, headers: res.headers };
}

async function wpFetch(path: string, init: RequestInit = {}) {
  return apiFetch(`/wp/v2${path}`, init);
}

async function rankMathFetch(path: string, init: RequestInit = {}) {
  return apiFetch(`/rankmath/v1${path}`, init);
}

function cleanPost(post: any) {
  return {
    id: post.id,
    date: post.date,
    modified: post.modified,
    slug: post.slug,
    status: post.status,
    link: post.link,
    title: post.title?.rendered || "",
    excerpt: post.excerpt?.rendered || "",
    content: post.content?.rendered || "",
    author: post.author,
    categories: post.categories || [],
    tags: post.tags || [],
    featured_media: post.featured_media || 0,
  };
}

function toolResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

const handler = createMcpHandler((server) => {
  server.registerTool(
    "get_latest_posts",
    {
      title: "Get latest HAPLAST posts",
      description:
        "Read the newest posts directly from HAPLAST WordPress, sorted by publication date descending.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).default(5),
        status: z.enum(["publish", "draft", "pending", "future", "private", "any"]).default("publish"),
      }),
    },
    async ({ limit, status }) => {
      const qs = new URLSearchParams({
        per_page: String(limit),
        orderby: "date",
        order: "desc",
        _embed: "1",
      });
      if (status !== "any") qs.set("status", status);
      const { data } = await wpFetch(`/posts?${qs.toString()}`);
      return toolResult((data as any[]).map(cleanPost));
    },
  );

  server.registerTool(
    "search_posts",
    {
      title: "Search HAPLAST posts",
      description:
        "Search WordPress posts by keyword and return matching HAPLAST articles with live content.",
      inputSchema: z.object({
        query: z.string().min(1),
        limit: z.number().int().min(1).max(100).default(20),
        status: z.enum(["publish", "draft", "pending", "future", "private", "any"]).default("publish"),
      }),
    },
    async ({ query, limit, status }) => {
      const qs = new URLSearchParams({
        search: query,
        per_page: String(limit),
        orderby: "relevance",
        order: "desc",
      });
      if (status !== "any") qs.set("status", status);
      const { data } = await wpFetch(`/posts?${qs.toString()}`);
      return toolResult((data as any[]).map(cleanPost));
    },
  );

  server.registerTool(
    "get_post",
    {
      title: "Get HAPLAST post",
      description:
        "Read one WordPress post by numeric post ID, including rendered title, excerpt and content.",
      inputSchema: z.object({
        id: z.number().int().positive(),
      }),
    },
    async ({ id }) => {
      const { data } = await wpFetch(`/posts/${id}?context=edit`);
      return toolResult(cleanPost(data));
    },
  );

  server.registerTool(
    "get_categories",
    {
      title: "Get HAPLAST categories",
      description: "List WordPress post categories from haplastgroup.com.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).default(100),
      }),
    },
    async ({ limit }) => {
      const { data } = await wpFetch(`/categories?per_page=${limit}&hide_empty=false`);
      return toolResult(data);
    },
  );

  server.registerTool(
    "get_tags",
    {
      title: "Get HAPLAST tags",
      description: "List WordPress post tags from haplastgroup.com.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).default(100),
      }),
    },
    async ({ limit }) => {
      const { data } = await wpFetch(`/tags?per_page=${limit}&hide_empty=false`);
      return toolResult(data);
    },
  );

  server.registerTool(
    "create_draft",
    {
      title: "Create HAPLAST draft",
      description:
        "Create a new WordPress post as DRAFT only. This tool never publishes automatically.",
      inputSchema: z.object({
        title: z.string().min(1),
        content: z.string().min(1),
        excerpt: z.string().optional(),
        slug: z.string().optional(),
        categories: z.array(z.number().int().positive()).optional(),
        tags: z.array(z.number().int().positive()).optional(),
      }),
    },
    async ({ title, content, excerpt, slug, categories, tags }) => {
      const payload: Record<string, unknown> = {
        title,
        content,
        status: "draft",
      };
      if (excerpt !== undefined) payload.excerpt = excerpt;
      if (slug) payload.slug = slug;
      if (categories) payload.categories = categories;
      if (tags) payload.tags = tags;

      const { data } = await wpFetch("/posts", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      return toolResult(cleanPost(data));
    },
  );

  server.registerTool(
    "update_post",
    {
      title: "Update HAPLAST post",
      description:
        "Update an existing WordPress post. Status is not changed unless explicitly supplied.",
      inputSchema: z.object({
        id: z.number().int().positive(),
        title: z.string().min(1).optional(),
        content: z.string().min(1).optional(),
        excerpt: z.string().optional(),
        slug: z.string().optional(),
        categories: z.array(z.number().int().positive()).optional(),
        tags: z.array(z.number().int().positive()).optional(),
      }),
    },
    async ({ id, ...changes }) => {
      const payload = Object.fromEntries(
        Object.entries(changes).filter(([, value]) => value !== undefined),
      );
      if (Object.keys(payload).length === 0) {
        throw new Error("No post fields supplied to update.");
      }
      const { data } = await wpFetch(`/posts/${id}`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      return toolResult(cleanPost(data));
    },
  );

  server.registerTool(
    "update_rank_math_seo",
    {
      title: "Update Rank Math SEO metadata",
      description:
        "Update Rank Math SEO fields for an existing WordPress post, including SEO title, meta description, focus keyword, canonical URL, and social metadata. Use after drafting or editing content.",
      inputSchema: z.object({
        id: z.number().int().positive(),
        seo_title: z.string().optional(),
        meta_description: z.string().optional(),
        focus_keyword: z.string().optional(),
        canonical_url: z.string().url().optional(),
        facebook_title: z.string().optional(),
        facebook_description: z.string().optional(),
        robots: z.array(z.string()).optional(),
      }),
    },
    async ({
      id,
      seo_title,
      meta_description,
      focus_keyword,
      canonical_url,
      facebook_title,
      facebook_description,
      robots,
    }) => {
      const meta: Record<string, unknown> = {};
      if (seo_title !== undefined) meta.rank_math_title = seo_title;
      if (meta_description !== undefined) meta.rank_math_description = meta_description;
      if (focus_keyword !== undefined) meta.rank_math_focus_keyword = focus_keyword;
      if (canonical_url !== undefined) meta.rank_math_canonical_url = canonical_url;
      if (facebook_title !== undefined) meta.rank_math_facebook_title = facebook_title;
      if (facebook_description !== undefined) meta.rank_math_facebook_description = facebook_description;
      if (robots !== undefined) meta.rank_math_robots = robots;

      if (Object.keys(meta).length === 0) {
        throw new Error("No Rank Math SEO fields supplied.");
      }

      const { data } = await rankMathFetch("/updateMeta", {
        method: "POST",
        body: JSON.stringify({
          objectID: id,
          objectType: "post",
          meta,
        }),
      });

      return toolResult({
        post_id: id,
        updated_meta: meta,
        rank_math_response: data,
      });
    },
  );

  server.registerTool(
    "get_rank_math_head",
    {
      title: "Read Rank Math rendered SEO head",
      description:
        "Read Rank Math's rendered SEO head for a public URL when Rank Math Headless CMS support is enabled. Useful for verifying title, description, canonical and social tags after publishing.",
      inputSchema: z.object({
        url: z.string().url(),
      }),
    },
    async ({ url }) => {
      const qs = new URLSearchParams({ url });
      const { data } = await rankMathFetch(`/getHead?${qs.toString()}`);
      return toolResult(data);
    },
  );

  server.registerTool(
    "create_seo_draft",
    {
      title: "Create HAPLAST SEO draft",
      description:
        "Create a WordPress draft and immediately save Rank Math SEO metadata. The post remains a draft and is never published by this tool.",
      inputSchema: z.object({
        title: z.string().min(1),
        content: z.string().min(1),
        excerpt: z.string().optional(),
        slug: z.string().optional(),
        categories: z.array(z.number().int().positive()).optional(),
        tags: z.array(z.number().int().positive()).optional(),
        seo_title: z.string().optional(),
        meta_description: z.string().optional(),
        focus_keyword: z.string().optional(),
        canonical_url: z.string().url().optional(),
      }),
    },
    async ({
      title,
      content,
      excerpt,
      slug,
      categories,
      tags,
      seo_title,
      meta_description,
      focus_keyword,
      canonical_url,
    }) => {
      const payload: Record<string, unknown> = {
        title,
        content,
        status: "draft",
      };
      if (excerpt !== undefined) payload.excerpt = excerpt;
      if (slug) payload.slug = slug;
      if (categories) payload.categories = categories;
      if (tags) payload.tags = tags;

      const { data: post } = await wpFetch("/posts", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      const meta: Record<string, unknown> = {};
      if (seo_title !== undefined) meta.rank_math_title = seo_title;
      if (meta_description !== undefined) meta.rank_math_description = meta_description;
      if (focus_keyword !== undefined) meta.rank_math_focus_keyword = focus_keyword;
      if (canonical_url !== undefined) meta.rank_math_canonical_url = canonical_url;

      let rankMathResponse: unknown = null;
      if (Object.keys(meta).length > 0) {
        const { data } = await rankMathFetch("/updateMeta", {
          method: "POST",
          body: JSON.stringify({
            objectID: post.id,
            objectType: "post",
            meta,
          }),
        });
        rankMathResponse = data;
      }

      return toolResult({
        post: cleanPost(post),
        rank_math_meta: meta,
        rank_math_response: rankMathResponse,
      });
    },
  );

  server.registerTool(
    "publish_post",
    {
      title: "Publish HAPLAST post",
      description:
        "Publish an existing WordPress post immediately. Use only when the user explicitly asks to publish.",
      inputSchema: z.object({
        id: z.number().int().positive(),
      }),
    },
    async ({ id }) => {
      const { data } = await wpFetch(`/posts/${id}`, {
        method: "POST",
        body: JSON.stringify({ status: "publish" }),
      });
      return toolResult(cleanPost(data));
    },
  );

  server.registerTool(
    "schedule_post",
    {
      title: "Schedule HAPLAST post",
      description:
        "Schedule an existing WordPress post. date must be an ISO-like WordPress local datetime, e.g. 2026-10-01T08:30:00.",
      inputSchema: z.object({
        id: z.number().int().positive(),
        date: z.string().min(10),
      }),
    },
    async ({ id, date }) => {
      const { data } = await wpFetch(`/posts/${id}`, {
        method: "POST",
        body: JSON.stringify({ status: "future", date }),
      });
      return toolResult(cleanPost(data));
    },
  );
});

export { handler as GET, handler as POST };
