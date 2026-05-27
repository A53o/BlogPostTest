const { Octokit } = require("@octokit/rest");
const markdownIt = require("markdown-it");
const fs = require("fs");
const path = require("path");

// ─── CONFIGURATION ── change these three values ──────────────
const OWNER = "A53o";
const REPO = "BlogPostTest";
const YOUR_USERNAME = "A53o";
// ──────────────────────────────────────────────────────────────

const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) {
  console.error("Missing GITHUB_TOKEN environment variable.");
  process.exit(1);
}

const octokit = new Octokit({ auth: TOKEN });
const md = new markdownIt({ html: true });

// Helpers
function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .substring(0, 60);
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
}

function extractFirstImage(rawMarkdown) {
  // Try HTML <img> tag first (GitHub's default paste style)
  const htmlImgRegex = /<img\b[^>]*?src=["']([^"']+)["'][^>]*>/i;
  const htmlMatch = rawMarkdown.match(htmlImgRegex);
  if (htmlMatch) return htmlMatch[1];
  // Fallback to Markdown ![alt](url)
  const mdImgRegex = /!\[[^\]]*\]\(([^)\s]+(?:\s"[^"]*")?)\)/;
  const mdMatch = rawMarkdown.match(mdImgRegex);
  if (mdMatch) return mdMatch[1];
  return null;
}

function buildPostCard(post, slug, linkPrefix = "") {
  const date = post.created_at.split("T")[0];
  const rawMarkdown = post.body || "";

  // Image
  const imageUrl = extractFirstImage(rawMarkdown);
  const imageHtml = imageUrl
    ? `<img src="${imageUrl}" alt="Post preview" class="post-image" loading="lazy">`
    : "";

  // Excerpt
  const rawHtml = md.render(rawMarkdown);
  let plainText = rawHtml.replace(/<[^>]*>/g, "").trim();
  plainText = decodeHtmlEntities(plainText);
  let excerpt = plainText.substring(0, 160);
  if (plainText.length > 160) excerpt += "…";

  // The link prefix allows the same card to work from different locations
  const postLink = `${linkPrefix}posts/${slug}.html`;

  return `
    <article class="post-card">
      ${imageHtml}
      <h2><a href="${postLink}">${escapeHtml(post.title)}</a></h2>
      <time datetime="${date}">${date}</time>
      <p class="excerpt">${escapeHtml(excerpt)}</p>
      <a href="${postLink}" class="read-more">Read more →</a>
    </article>`;
}

async function generatePosts() {
  console.log("Fetching issues…");

  const { data: issues } = await octokit.issues.listForRepo({
    owner: OWNER,
    repo: REPO,
    state: "open",
    per_page: 100,
  });

  // Security: only your issues, ignoring pull requests
  const myPosts = issues.filter(
    (issue) =>
      issue.user.login === YOUR_USERNAME && !issue.pull_request
  );

  console.log(`Found ${myPosts.length} post(s) from you.`);

  // Sort by newest first
  myPosts.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  // Ensure output directories exist
  const postsDir = path.join(__dirname, "..", "posts");
  const blogsDir = path.join(__dirname, "..", "blogs");
  for (const dir of [postsDir, blogsDir]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  // Load templates (now inside /blogs folder)
  const postTemplate = fs.readFileSync(
    path.join(__dirname, "..", "blogs", "template.html"),
    "utf8"
  );
  const blogHomeTemplate = fs.readFileSync(
    path.join(__dirname, "..", "blogs", "blog-home.html"),
    "utf8"
  );

  // ─── 1) Generate individual post pages ───
  for (const issue of myPosts) {
    const contentHtml = md.render(issue.body || "");
    const pageHtml = postTemplate
      .replace(/{{TITLE}}/g, escapeHtml(issue.title))
      .replace(/{{DATE}}/g, issue.created_at.split("T")[0])
      .replace(/{{CONTENT}}/g, contentHtml);

    const slug = slugify(issue.title) || `post-${issue.number}`;
    const filePath = path.join(postsDir, `${slug}.html`);
    fs.writeFileSync(filePath, pageHtml);
    console.log(`✔ Created posts/${slug}.html`);
  }

  // ─── 2) Build blog homepage (ALL posts) ───
  let allPostsHtml = "";
  if (myPosts.length === 0) {
    allPostsHtml = "<p>No posts yet. Check back soon!</p>";
  } else {
    allPostsHtml = '<div class="post-grid">';
    for (const post of myPosts) {
      const slug = slugify(post.title) || `post-${post.number}`;
      // From /blogs/index.html, the path to posts is ../posts/
      const card = buildPostCard(post, slug, "../");
      allPostsHtml += card;
    }
    allPostsHtml += "</div>";
  }

  const blogHomeHtml = blogHomeTemplate.replace(/{{ALL_POSTS}}/g, allPostsHtml);
  fs.writeFileSync(path.join(blogsDir, "index.html"), blogHomeHtml);
  console.log("✔ Generated blogs/index.html");

  // ─── 3) Generate latest‑posts snippet (4 posts) ───
  const latestPosts = myPosts.slice(0, 4);
  let snippetHtml = '<div class="post-grid">';
  const jsonPosts = [];

  for (const post of latestPosts) {
    const slug = slugify(post.title) || `post-${post.number}`;
    // For the snippet (used from root), paths are relative to root: posts/
    const card = buildPostCard(post, slug, "");
    snippetHtml += card;

    jsonPosts.push({
      title: post.title,
      date: post.created_at.split("T")[0],
      slug: slug,
      excerpt: decodeHtmlEntities(
        md.render(post.body || "")
          .replace(/<[^>]*>/g, "")
          .trim()
          .substring(0, 160)
      ),
      image: extractFirstImage(post.body || ""),
    });
  }
  snippetHtml += "</div>";

  fs.writeFileSync(path.join(__dirname, "..", "latest-posts.html"), snippetHtml);
  fs.writeFileSync(
    path.join(__dirname, "..", "latest-posts.json"),
    JSON.stringify(jsonPosts, null, 2)
  );
  console.log("✔ Generated latest-posts.html and latest-posts.json");
}

generatePosts().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});