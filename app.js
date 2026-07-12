const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const STORAGE = { resume: 'cdy.resume.v1', posts: 'cdy.posts.v1' };
const resume = $('#resumeDocument');
const originalResume = resume.innerHTML;
let activeTag = '全部';

const seedPosts = [
  { id: crypto.randomUUID(), title: '从 PB 级数据平台到业务价值：架构设计中的三个取舍', summary: '数据平台的价值不在组件数量，而在稳定、成本和业务响应速度之间找到平衡。', tags: ['数据架构', '大数据'], date: '2026-07-08', content: `# 架构不是组件清单\n\n一个优秀的数据平台，需要先回答三个问题：**服务谁、解决什么、如何衡量**。\n\n## 1. 实时与离线的边界\n\n并非所有数据都需要实时处理。围绕业务时效性定义 SLA，再选择合适的计算链路。\n\n## 2. 成本也是架构指标\n\n通过冷热分层、生命周期管理与弹性计算，让资源跟随价值流动。\n\n## 3. 可治理才能持续演进\n\n元数据、质量规则和血缘关系，应当从平台建设第一天开始。` },
  { id: crypto.randomUUID(), title: '让 RAG 真正走进生产：从召回率到可观测性', summary: '分享企业知识库从验证到生产落地时，检索、评估和工程治理的关键环节。', tags: ['AI', 'RAG'], date: '2026-06-21', content: `# RAG 的生产化挑战\n\nDemo 能回答问题，不代表系统可以稳定服务真实用户。\n\n## 建立评估基线\n\n准备覆盖真实场景的问答集，分别评估召回、排序和生成效果。\n\n## 让链路可观测\n\n记录查询改写、召回文档、模型版本、延迟与用户反馈，才能定位质量波动。\n\n> 先建立可度量的反馈闭环，再讨论复杂的 Agent 编排。` },
  { id: crypto.randomUUID(), title: '技术负责人如何做好方案评审', summary: '方案评审不是找错，而是帮助团队更早地发现约束、对齐目标并降低交付风险。', tags: ['技术管理', '架构'], date: '2026-05-30', content: `# 一次有效的方案评审\n\n评审前明确业务目标、约束和不做什么。评审中重点关注：\n\n- 核心链路是否清晰\n- 容量与故障模型是否可信\n- 数据一致性如何保证\n- 上线、回滚和观测是否完整\n\n评审结论应形成可追踪的决策记录，而不是停留在会议中。` }
];

function showPage(id) {
  $$('.page').forEach(page => page.classList.toggle('active', page.id === id));
  $$('.nav-link').forEach(link => link.classList.toggle('active', link.dataset.page === id || (['post', 'editor'].includes(id) && link.dataset.page === 'blog')));
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

function getPosts() { try { return JSON.parse(localStorage.getItem(STORAGE.posts)) || seedPosts; } catch { return seedPosts; } }
function savePosts(posts) { localStorage.setItem(STORAGE.posts, JSON.stringify(posts)); }
function escapeHtml(value='') { return value.replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function renderPosts() {
  const query = $('#blogSearch').value.trim().toLowerCase(); const posts = getPosts();
  const tags = ['全部', ...new Set(posts.flatMap(post => post.tags))];
  $('#tagFilters').innerHTML = tags.map(tag => `<button class="${tag === activeTag ? 'active' : ''}" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`).join('');
  $$('[data-tag]').forEach(btn => btn.onclick = () => { activeTag = btn.dataset.tag; renderPosts(); });
  const filtered = posts.filter(post => (activeTag === '全部' || post.tags.includes(activeTag)) && [post.title, post.summary, post.content, ...post.tags].join(' ').toLowerCase().includes(query));
  $('#blogList').innerHTML = filtered.map(post => `<article class="blog-card"><time>${post.date}</time><h2>${escapeHtml(post.title)}</h2><p>${escapeHtml(post.summary)}</p><div class="card-tags">${post.tags.map(tag => `<span>#${escapeHtml(tag)}</span>`).join('')}</div><div class="card-actions"><button class="text-button" data-read="${post.id}">阅读全文 →</button><span><button class="text-button" data-edit="${post.id}">编辑</button> · <button class="text-button danger" data-delete="${post.id}">删除</button></span></div></article>`).join('');
  $('#emptyBlog').classList.toggle('hidden', filtered.length > 0);
  $$('[data-read]').forEach(btn => btn.onclick = () => openPost(btn.dataset.read));
  $$('[data-edit]').forEach(btn => btn.onclick = () => openEditor(btn.dataset.edit));
  $$('[data-delete]').forEach(btn => btn.onclick = () => { if (confirm('确定删除这篇文章吗？')) { savePosts(posts.filter(p => p.id !== btn.dataset.delete)); renderPosts(); toast('文章已删除'); } });
}
$('#blogSearch').addEventListener('input', renderPosts);
function markdown(source) {
  return escapeHtml(source).replace(/^### (.*)$/gm,'<h3>$1</h3>').replace(/^## (.*)$/gm,'<h2>$1</h2>').replace(/^# (.*)$/gm,'<h1>$1</h1>').replace(/^&gt; (.*)$/gm,'<blockquote>$1</blockquote>').replace(/```([\s\S]*?)```/g,'<pre><code>$1</code></pre>').replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/^- (.*)$/gm,'<li>$1</li>').replace(/(<li>.*<\/li>\n?)+/g,'<ul>$&</ul>').split(/\n{2,}/).map(block => /^<(h\d|ul|pre|blockquote)/.test(block) ? block : `<p>${block.replace(/\n/g,'<br>')}</p>`).join('');
}
function openPost(id) { const post = getPosts().find(p => p.id === id); if (!post) return; $('#postDetail').innerHTML = `<p class="eyebrow">${post.tags.map(escapeHtml).join(' · ')}</p><h1>${escapeHtml(post.title)}</h1><p class="post-meta">发布于 ${post.date}</p><div class="post-body">${markdown(post.content)}</div>`; showPage('post'); }
$('#backBlog').onclick = () => showPage('blog');
function updatePreview() {
  const content = $('#postContent').value;
  $('#livePreview').innerHTML = content.trim() ? markdown(content) : '<p class="preview-placeholder">预览内容将在这里实时呈现。</p>';
  $('#wordCount').textContent = `${content.replace(/\s/g, '').length} 字`;
}
function openEditor(id = '') {
  const post = getPosts().find(p => p.id === id);
  $('#postForm').reset();
  $('#postId').value = post?.id || '';
  $('#postTitle').value = post?.title || '';
  $('#postSummary').value = post?.summary || '';
  $('#postTags').value = post?.tags.join(', ') || '';
  $('#postContent').value = post?.content || '';
  $('#editorTitle').textContent = post ? '编辑文章' : '发布新文章';
  updatePreview();
  showPage('editor');
  setTimeout(() => $('#postTitle').focus(), 100);
}
$('#postContent').addEventListener('input', updatePreview);
$('#newPost').onclick = () => openEditor();
$('#cancelPost').onclick = () => showPage('blog');
$('#postForm').addEventListener('submit', event => { event.preventDefault(); const posts = getPosts(); const id = $('#postId').value || crypto.randomUUID(); const post = { id, title: $('#postTitle').value.trim(), summary: $('#postSummary').value.trim(), tags: $('#postTags').value.split(/[,，]/).map(t => t.trim()).filter(Boolean), content: $('#postContent').value.trim(), date: new Date().toISOString().slice(0,10) }; const index = posts.findIndex(p => p.id === id); if (index >= 0) posts[index] = post; else posts.unshift(post); savePosts(posts); activeTag = '全部'; renderPosts(); showPage('blog'); toast(index >= 0 ? '文章已更新' : '文章已发布'); });
renderPosts();
