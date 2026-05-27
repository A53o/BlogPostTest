const { Octokit } = require("@octokit/rest");
const markdownIt = require("markdown-it");
const fs = require("fs");
const path = require("path");

// ─── CONFIGURATION ── Change these three values ──────────────
const OWNER = "your-github-username";        // your GitHub username
const REPO = "my-blog";                      // this repository name
const YOUR_USERNAME = "your-github-username"; // the only allowed issue author
// ──────────────────────────────────────────────────────────────

const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) {
  console.error("Missing GITHUB_TOKEN environment variable.");
  process.exit(1);
}

const octokit = new Octokit({ auth: TOKEN });
const md = new markdownIt({ html: true });

// Helper: escape HTML to avoid XSS in titles
function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Helper: create a safe filename (slug) from a title
function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .substring(0, 60);
}

async function generatePosts() {
  console.log("Fetching issues…");

  const { data: issues } = await octokit.issues.listForRepo({
    owner: OWNER,
    repo: REPO,
    state: "open",
    per_page: 100,
  });

  // ⚠️ SECURITY: keep only issues created by YOU (ignore pull requests)
  const myPosts = issues.filter(
    (issue) =>
      issue.user.login === YOUR_USERNAME && !issue.pull_request
  );

  console.log(`Found ${myPosts.length} post(s) from you.`);

  // Prepare output directory for individual posts
  const outDir = path.join(__dirname, "..", "posts");
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  // Load the individual post template
  const postTemplate = fs.readFileSync(
    path.join(__dirname, "..", "template.html"),
    "utf8"
  );

  // --- Step 1: Generate each post page ---
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

  // --- Step 2: Build the homepage with the 3 most recent posts ---
  // Sort by creation date, newest first
  myPosts.sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at)
  );

  const recentPosts = myPosts.slice(0, 3);

  let postListHtml = "";
  if (recentPosts.length === 0) {
    postListHtml = "<p>No posts yet. Check back soon!</p>";
  } else {
    postListHtml = "<ul>";
    for (const post of recentPosts) {
      const slug = slugify(post.title) || `post-${post.number}`;
      const date = post.created_at.split("T")[0];
      postListHtml += `
        <li>
          <a href="posts/${slug}.html">${escapeHtml(post.title)}</a>
          <small>(${date})</small>
        </li>`;
    }
    postListHtml += "</ul>";
  }

  // Load the homepage template and insert the list
  const homeTemplate = fs.readFileSync(
    path.join(__dirname, "..", "home.html"),
    "utf8"
  );
  const homePageHtml = homeTemplate.replace(/{{POST_LIST}}/g, postListHtml);

  // Write it as index.html (the actual homepage)
  fs.writeFileSync(
    path.join(__dirname, "..", "index.html"),
    homePageHtml
  );
  console.log("✔ Generated index.html with recent posts");
}

generatePosts().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});