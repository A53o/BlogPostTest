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

async function generatePosts() {
  console.log("Fetching issues…");

  const { data: issues } = await octokit.issues.listForRepo({
    owner: OWNER,
    repo: REPO,
    state: "open",
    per_page: 100,
  });

  const myPosts = issues.filter(
    (issue) =>
      issue.user.login === YOUR_USERNAME && !issue.pull_request
  );

  console.log(`Found ${myPosts.length} post(s) from you.`);

  const outDir = path.join(__dirname, "..", "posts");
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const postTemplate = fs.readFileSync(
    path.join(__dirname, "..", "template.html"),
    "utf8"
  );

  // Generate individual post pages
  for (const issue of myPosts) {
    const contentHtml = md.render(issue.body || "");
    const pageHtml = postTemplate
      .replace(/{{TITLE}}/g, escapeHtml(issue.title))
      .replace(/{{DATE}}/g, issue.created_at.split("T")[0])
      .replace(/{{CONTENT}}/g, contentHtml);

    const slug = slugify(issue.title) || `post-${issue.number}`;
    const filePath = path.join(outDir, `${slug}.html`);
    fs.writeFileSync(filePath, pageHtml);
    console.log(`✔ Created posts/${slug}.html`);
  }

  // Build homepage with excerpt cards
  myPosts.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const recentPosts = myPosts.slice(0, 3);

  let postListHtml = "";
  if (recentPosts.length === 0) {
    postListHtml = "<p>No posts yet. Check back soon!</p>";
  } else {
    postListHtml = '<div class="post-grid">';
    for (const post of recentPosts) {
      const slug = slugify(post.title) || `post-${post.number}`;
      const date = post.created_at.split("T")[0];
      const rawMarkdown = post.body || "";

      // ── Extract the first image from Markdown or HTML ───
      let imageHtml = "";

      // 1) Try HTML <img> tag (GitHub's default paste style)
      const htmlImgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/i;
      const htmlMatch = rawMarkdown.match(htmlImgRegex);
      if (htmlMatch) {
        const imageUrl = htmlMatch[1];
        imageHtml = `<img src="${imageUrl}" alt="Post preview" class="post-image" loading="lazy">`;
      } else {
        // 2) Fallback to Markdown ![alt](url)
        const mdImgRegex = /!\[[^\]]*\]\(([^)\s]+(?:\s"[^"]*")?)\)/;
        const mdMatch = rawMarkdown.match(mdImgRegex);
        if (mdMatch) {
          const imageUrl = mdMatch[1];
          imageHtml = `<img src="${imageUrl}" alt="Post preview" class="post-image" loading="lazy">`;
        }
      }
      // ──────────────────────────────────────────────────

      // Generate clean, plain‑text excerpt
      let rawHtml = md.render(rawMarkdown);
      let plainText = rawHtml.replace(/<[^>]*>/g, "").trim();
      plainText = decodeHtmlEntities(plainText);
      let excerpt = plainText.substring(0, 160);
      if (plainText.length > 160) excerpt += "…";

      postListHtml += `
        <article class="post-card">
          ${imageHtml}
          <h2><a href="posts/${slug}.html">${escapeHtml(post.title)}</a></h2>
          <time datetime="${date}">${date}</time>
          <p class="excerpt">${escapeHtml(excerpt)}</p>
          <a href="posts/${slug}.html" class="read-more">Read more →</a>
        </article>`;
    }
    postListHtml += "</div>";
  }

  const homeTemplate = fs.readFileSync(
    path.join(__dirname, "..", "home.html"),
    "utf8"
  );
  const homePageHtml = homeTemplate.replace(/{{POST_LIST}}/g, postListHtml);

  fs.writeFileSync(path.join(__dirname, "..", "index.html"), homePageHtml);
  console.log("✔ Generated index.html with recent posts");
}

generatePosts().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});