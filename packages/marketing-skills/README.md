# Marketing skills extension

This workspace Eve extension mounts the reviewed Content, Distribution, and SEO
Discovery skills. The materializer copies `copywriting`, `content-strategy`,
`copy-editing`, `seo-audit`, and `ai-seo` from `.agents/skills` and rewrites
brand-file lookups to `get_brand_context`.

The root materialization command mounts this package before every agent build.
Ads, pricing, and SMS skills stay out of this subset.
