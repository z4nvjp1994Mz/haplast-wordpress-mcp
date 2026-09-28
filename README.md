# HAPLAST WordPress MCP

Remote MCP server for `haplastgroup.com`.

## What it can do

- Read latest WordPress posts
- Search existing posts
- Read a post by ID
- List categories and tags
- Create drafts
- Update posts
- Publish a post when explicitly requested
- Schedule a post

## Required Vercel environment variables

```
WORDPRESS_URL=https://haplastgroup.com
WORDPRESS_USERNAME=YOUR_WORDPRESS_USERNAME
WORDPRESS_APP_PASSWORD=YOUR_APPLICATION_PASSWORD
```

Do not commit the WordPress Application Password to GitHub.

## MCP endpoint after deploying to Vercel

```
https://YOUR-PROJECT.vercel.app/mcp
```

## Security

The WordPress Application Password is stored only as a Vercel Environment Variable.
The MCP server does not expose the credential in tool outputs.
