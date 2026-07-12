const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const STORAGE = { resume: 'cdy.resume.v1' };
const resume = $('#resumeDocument');
const originalResume = resume.innerHTML;
let activeTag = '全部';

let posts = [];

function showPage(id) {
  $$('.page').forEach(page => page.classList.toggle('active', page.id === id));
  $$('.nav-link').forEach(link => link.classList.toggle('active', link.dataset.page === id || (id === 'post' && link.dataset.page === 'blog')));
  scrollTo({ top: 0, behavior: 'smooth' });
}
$$('[data-page]').forEach(button => button.addEventListener('click', () => showPage(button.dataset.page)));
$('.brand').addEventListener('click', event => { event.preventDefault(); showPage('home'); });
$('#year').textContent = new Date().getFullYear();

function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 2200); }
function setEditing(enabled) {
  resume.classList.toggle('editing', enabled);
  $$('h1,h2,h3,h4,p,li,dt,dd,span,b,time', resume).forEach(el => el.contentEditable = enabled);
  $('#editResume').classList.toggle('hidden', enabled); $('#saveResume').classList.toggle('hidden', !enabled); $('#cancelEdit').classList.toggle('hidden', !enabled); $('#editNotice').classList.toggle('hidden', !enabled);
}
const savedResume = localStorage.getItem(STORAGE.resume); if (savedResume) resume.innerHTML = savedResume.replace(/1[3-9]\d{9}\s*(<br\s*\/?>)?/gi, '');
$('#editResume').addEventListener('click', () => setEditing(true));
$('#saveResume').addEventListener('click', () => { setEditing(false); localStorage.setItem(STORAGE.resume, resume.innerHTML); toast('简历修改已保存'); });
$('#cancelEdit').addEventListener('click', () => { resume.innerHTML = localStorage.getItem(STORAGE.resume) || originalResume; setEditing(false); toast('已取消本次修改'); });
$('#exportToggle').addEventListener('click', e => { e.stopPropagation(); $('#exportOptions').classList.toggle('hidden'); });
document.addEventListener('click', () => $('#exportOptions').classList.add('hidden'));

function download(name, content, type) { const url = URL.createObjectURL(new Blob([content], { type })); const a = Object.assign(document.createElement('a'), { href: url, download: name }); a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function resumeMarkdown() {
  const clone = resume.cloneNode(true);
  clone.querySelectorAll('h1,h2,h3,h4').forEach(el => { const level = Number(el.tagName[1]); el.replaceWith(`\n${'#'.repeat(level)} ${el.textContent.trim()}\n`); });
  clone.querySelectorAll('li').forEach(el => el.replaceWith(`\n- ${el.textContent.trim()}`));
  clone.querySelectorAll('p,div,section,header,aside').forEach(el => el.append('\n'));
  return clone.textContent.replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
function exportHtml() {
  const css = [...document.styleSheets].map(sheet => { try { return [...sheet.cssRules].map(rule => rule.cssText).join('\n'); } catch { return ''; } }).join('\n');
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width"><title>陈德宇 - 个人简历</title><style>${css}\nbody{padding:30px}.resume-paper{margin:auto}</style></head><body>${resume.outerHTML}</body></html>`;
  download('陈德宇-个人简历.html', html, 'text/html;charset=utf-8');
}
$$('[data-export]').forEach(button => button.addEventListener('click', () => { const type = button.dataset.export; if (type === 'html') exportHtml(); if (type === 'markdown') download('陈德宇-个人简历.md', resumeMarkdown(), 'text/markdown;charset=utf-8'); if (type === 'pdf') { showPage('resume'); setTimeout(() => window.print(), 100); } }));

function escapeHtml(value='') { return value.replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function renderPosts() {
  const query = $('#blogSearch').value.trim().toLowerCase();
  const tags = ['全部', ...new Set(posts.flatMap(post => post.tags))];
  $('#tagFilters').innerHTML = tags.map(tag => `<button class="${tag === activeTag ? 'active' : ''}" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`).join('');
  $$('[data-tag]').forEach(btn => btn.onclick = () => { activeTag = btn.dataset.tag; renderPosts(); });
  const filtered = posts.filter(post => (activeTag === '全部' || post.tags.includes(activeTag)) && [post.title, post.summary, post.content, ...post.tags].join(' ').toLowerCase().includes(query));
  $('#blogList').innerHTML = filtered.map(post => `<article class="blog-card"><time>${post.date}</time><h2>${escapeHtml(post.title)}</h2><p>${escapeHtml(post.summary)}</p><div class="card-tags">${post.tags.map(tag => `<span>#${escapeHtml(tag)}</span>`).join('')}</div><div class="card-actions"><button class="text-button" data-read="${escapeHtml(post.slug)}">阅读全文 →</button></div></article>`).join('');
  $('#emptyBlog').classList.toggle('hidden', filtered.length > 0);
  $$('[data-read]').forEach(btn => btn.onclick = () => openPost(btn.dataset.read));
}
$('#blogSearch').addEventListener('input', renderPosts);
function markdown(source) {
  return escapeHtml(source).replace(/^### (.*)$/gm,'<h3>$1</h3>').replace(/^## (.*)$/gm,'<h2>$1</h2>').replace(/^# (.*)$/gm,'<h1>$1</h1>').replace(/^&gt; (.*)$/gm,'<blockquote>$1</blockquote>').replace(/```([\s\S]*?)```/g,'<pre><code>$1</code></pre>').replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/^- (.*)$/gm,'<li>$1</li>').replace(/(<li>.*<\/li>\n?)+/g,'<ul>$&</ul>').split(/\n{2,}/).map(block => /^<(h\d|ul|pre|blockquote)/.test(block) ? block : `<p>${block.replace(/\n/g,'<br>')}</p>`).join('');
}
async function openPost(slug) {
  const post = posts.find(item => item.slug === slug); if (!post) return;
  $('#postDetail').innerHTML = '<p class="post-meta">文章加载中…</p>'; showPage('post');
  try { const response = await fetch(`posts/${encodeURIComponent(post.file)}`); if (!response.ok) throw new Error(); const content = await response.text(); $('#postDetail').innerHTML = `<p class="eyebrow">${post.tags.map(escapeHtml).join(' · ')}</p><h1>${escapeHtml(post.title)}</h1><p class="post-meta">发布于 ${post.date}</p><div class="post-body">${markdown(content)}</div>`; }
  catch { $('#postDetail').innerHTML = '<h1>文章加载失败</h1><p>请稍后刷新页面重试。</p>'; }
}
$('#backBlog').onclick = () => showPage('blog');
async function loadPosts() {
  try { const response = await fetch('posts/index.json', { cache: 'no-cache' }); if (!response.ok) throw new Error(); posts = await response.json(); posts.sort((a,b) => b.date.localeCompare(a.date)); renderPosts(); }
  catch { $('#blogList').innerHTML = ''; $('#emptyBlog').classList.remove('hidden'); $('#emptyBlog b').textContent = '文章加载失败'; $('#emptyBlog p').textContent = '请稍后刷新页面重试。'; }
}
loadPosts();
