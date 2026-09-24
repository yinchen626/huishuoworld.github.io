/* 溯回纪元 wiki —— 浏览器端 markdown 渲染 */
(function () {
  'use strict';

  var MANIFEST = './manifest.json';
  var CONTENT = './content/';
  var $ = function (s, r) { return (r || document).querySelector(s); };

  var state = {
    manifest: null,
    map: {},        // 名称 / 别名 -> id
    byId: {},
    cache: {},      // id -> md 原文
    current: null
  };

  /* ---------- 主题 ---------- */
  function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem('hs-theme'); } catch (e) { }
    if (saved === 'light') document.body.classList.remove('theme-dark');
    else document.body.classList.add('theme-dark'); // 默认深色
    var btn = $('#theme-btn');
    btn.addEventListener('click', function () {
      var dark = document.body.classList.toggle('theme-dark');
      try { localStorage.setItem('hs-theme', dark ? 'dark' : 'light'); } catch (e) { }
    });
  }

  /* ---------- 工具 ---------- */
  function encPath(id) {
    return id.split('/').map(encodeURIComponent).join('/');
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function stripMd(s) {
    return s
      .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2')
      .replace(/!\[\[[^\]]*\]\]/g, '')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/\*\*([^*]*)\*\*/g, '$1')
      .replace(/\*([^*]*)\*/g, '$1')
      .replace(/~~([^~]*)~~/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^[#>\-\s|]+/g, '')
      .replace(/[|>]/g, ' ')
      .trim();
  }

  /* ---------- frontmatter ---------- */
  function splitFront(md) {
    var data = {}, body = md;
    if (md.slice(0, 3) === '---') {
      var end = md.indexOf('\n---', 3);
      if (end > -1) {
        var lines = md.slice(3, end).split('\n');
        lines.forEach(function (ln) {
          var m = ln.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
          if (!m) return;
          var k = m[1], v = m[2].trim();
          if (v.charAt(0) === '[') {
            data[k] = v.replace(/^\[|\]$/g, '').split(',').map(function (x) {
              return x.trim().replace(/^["']|["']$/g, '');
            }).filter(Boolean);
          } else {
            data[k] = v.replace(/^["']|["']$/g, '');
          }
        });
        body = md.slice(md.indexOf('\n', end + 1) + 1);
      }
    }
    return { data: data, body: body };
  }

  /* ---------- 名称 -> id 映射 ---------- */
  function buildMap(pages) {
    Object.keys(pages).forEach(function (id) {
      var p = pages[id];
      state.byId[id] = p;
      function put(name) {
        if (!name) return;
        name = String(name).trim();
        if (!state.map[name]) state.map[name] = id;
      }
      put(p.title);
      put(id.split('/').pop());
      (p.aliases || []).forEach(put);
    });
  }
  function resolve(name) {
    var n = String(name).trim();
    if (state.map[n]) return state.map[n];
    // 尝试按结尾文件名匹配（处理 OC设定/xxx/yyy 之类的路径链接）
    var tail = n.split('/').pop();
    if (state.map[tail]) return state.map[tail];
    var keys = Object.keys(state.map);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].toLowerCase() === n.toLowerCase()) return state.map[keys[i]];
    }
    return null;
  }

  /* ---------- markdown -> HTML（自带渲染器，无外部依赖） ---------- */
  function renderMarkdown(md) {
    return transformWiki(mdToHtml(md));
  }

  function isBlockStart(l) {
    return /^\s{0,3}(#{1,6}\s|>|```|~~~|([-*+]|\d+[.)])\s)/.test(l) ||
      /^\s*([-*_])\s*(\1\s*){2,}$/.test(l) || /\|/.test(l);
  }

  // 表格行切分：尊重 \|
  function splitRow(row) {
    var cells = [], cur = '';
    row = row.trim().replace(/^\|/, '').replace(/\|$/, '');
    for (var i = 0; i < row.length; i++) {
      if (row[i] === '\\' && row[i + 1] === '|') { cur += '|'; i++; continue; }
      if (row[i] === '|') { cells.push(cur); cur = ''; continue; }
      cur += row[i];
    }
    cells.push(cur);
    return cells.map(function (c) { return c.trim(); });
  }

  function mdToHtml(src) {
    var lines = String(src).replace(/\r\n?/g, '\n').split('\n');
    return block(lines, 0).html;
  }

  function block(lines, i) {
    var out = '';
    while (i < lines.length) {
      var line = lines[i];

      if (!line.trim()) { i++; continue; }

      // 代码块
      var fm = line.match(/^ {0,3}(```|~~~)\s*(\S*)/);
      if (fm) {
        var fence = fm[1], lang = fm[2], buf = [];
        i++;
        while (i < lines.length && lines[i].indexOf(fence) === -1) { buf.push(lines[i]); i++; }
        i++;                                                        // 跳过收尾 fence
        while (buf.length && !buf[buf.length - 1].trim()) buf.pop();
        out += '<pre><code' + (lang ? ' class="language-' + esc(lang) + '"' : '') + '>'
          + esc(buf.join('\n')) + '</code></pre>\n';
        continue;
      }

      // 标题
      var hm = line.match(/^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
      if (hm) {
        var d = hm[1].length;
        out += '<h' + d + '>' + inline(hm[2]) + '</h' + d + '>\n';
        i++;
        continue;
      }

      // 分隔线
      if (/^\s{0,3}([-*_])\s*(\1\s*){2,}$/.test(line)) { out += '<hr>\n'; i++; continue; }

      // 引用块
      if (/^\s{0,3}>/.test(line)) {
        var q = [];
        while (i < lines.length) {
          if (/^\s{0,3}>/.test(lines[i])) {
            q.push(lines[i].replace(/^\s{0,3}>\s?/, '')); i++;
          } else if (lines[i].trim() && !isBlockStart(lines[i])) {
            q.push(lines[i]); i++;                                   // 惰性续行
          } else break;
        }
        out += '<blockquote>\n' + mdToHtml(q.join('\n')) + '</blockquote>\n';
        continue;
      }

      // 列表
      if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
        var r = listBlock(lines, i);
        out += r.html; i = r.next;
        continue;
      }

      // 表格
      if (line.indexOf('|') > -1 && i + 1 < lines.length &&
        /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(lines[i + 1])) {
        var head = splitRow(line), align = splitRow(lines[i + 1]), rows = [];
        i += 2;
        while (i < lines.length && lines[i].indexOf('|') > -1 && lines[i].trim()) { rows.push(splitRow(lines[i])); i++; }
        var th = align.map(function (a, k) {
          return '<th>' + inline(head[k] || '') + '</th>';
        }).join('');
        var tb = rows.map(function (row) {
          return '<tr>' + align.map(function (a, k) { return '<td>' + inline(row[k] || '') + '</td>'; }).join('') + '</tr>';
        }).join('\n');
        out += '<table>\n<thead>\n<tr>' + th + '</tr>\n</thead>\n<tbody>\n' + tb + '\n</tbody>\n</table>\n';
        continue;
      }

      // 段落
      var p = [];
      while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) { p.push(lines[i]); i++; }
      if (!p.length) { p.push(lines[i]); i++; }
      out += '<p>' + inline(p.join('\n').replace(/\n/g, ' ')) + '</p>\n';
    }
    return { html: out, next: i };
  }

  function listBlock(lines, i) {
    var base = lines[i].match(/^\s*/)[0].length;
    var ordered = /^\s*\d+[.)]\s/.test(lines[i]);
    var start = ordered ? parseInt(lines[i].trim(), 10) : 1;
    var items = [];
    while (i < lines.length) {
      var l = lines[i];
      if (!l.trim()) {
        // 空行后如果有缩进内容，仍属于当前项
        if (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1]) && items.length) {
          items[items.length - 1].push(''); i++; continue;
        }
        break;
      }
      var m = l.match(/^(\s*)([*+-]|\d+[.)])\s+(.*)$/);
      if (m) {
        var ind = m[1].length;
        if (ind < base) break;
        if (ind > base && items.length) { items[items.length - 1].push(l); i++; continue; }
        if (ind === base) {
          items.push([m[3]]); i++;
          continue;
        }
        break;
      }
      // 续行（缩进或惰性延续）
      if (items.length) {
        items[items.length - 1].push(l.replace(/^\s{1,4}/, ''));
        i++;
        continue;
      }
      break;
    }
    var html = '<' + (ordered ? 'ol' : 'ul') + (ordered && start !== 1 ? ' start="' + start + '"' : '') + '>\n';
    items.forEach(function (rawLines) {
      var first = rawLines[0];
      var task = first.match(/^\[([ xX])\]\s+(.*)$/);
      var content = rawLines.slice(task ? 1 : 0);
      if (task) content[0] = task[2];
      var body = mdToHtml(content.join('\n'));
      var single = body.match(/^<p>([\s\S]*?)<\/p>\s*$/);
      if (single) body = single[1];
      var cb = task ? '<input disabled="" type="checkbox"' + (task[1] !== ' ' ? ' checked=""' : '') + '> ' : '';
      html += '<li>' + cb + body + '</li>\n';
    });
    html += '</' + (ordered ? 'ol' : 'ul') + '>\n';
    return { html: html, next: i };
  }

  function inline(s) {
    var codes = [];
    s = s.replace(/`([^`]+)`/g, function (m, c) {
      codes.push(c);
      return '\u0001' + (codes.length - 1) + '\u0001';
    });
    s = esc(s);
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]*)[^)]*\)/g, function (m, a, u) {
      return '<img src="' + u + '" alt="' + a + '">';
    });
    s = s.replace(/\[([^\]]*)\]\(([^)\s]*)[^)]*\)/g, function (m, t, u) {
      var ext = /^(https?:)?\/\//.test(u);
      return '<a href="' + u + '"' + (ext ? ' target="_blank" rel="noopener"' : '') + '>' + t + '</a>';
    });
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    s = s.replace(/==([^=]+)==/g, '<mark>$1</mark>');
    s = s.replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/(^|[^_\w])_([^_\n]+)_/g, '$1<em>$2</em>');
    s = s.replace(/\u0001(\d+)\u0001/g, function (m, idx) {
      return '<code>' + esc(codes[idx]) + '</code>';
    });
    return s;
  }

  function transformWiki(s) {
    // 跳过 <pre> / <code> 内部
    var codeRe = /(<pre>[\s\S]*?<\/pre>|<code>[\s\S]*?<\/code>)/g;
    var parts = s.split(codeRe);
    return parts.map(function (part, i) {
      if (i % 2 === 1) return part;
      return convertLinks(part);
    }).join('');
  }

  function convertLinks(s) {
    // ![[嵌入]]
    s = s.replace(/!\[\[([^\]]+)\]\]/g, function (m, t) {
      return '<span class="embed-ph">附件：' + esc(t.split('|').pop()) + '</span>';
    });
    // [[页面]] / [[页面|别名]] / [[页面\|别名]]（表格里的转义竖线）
    s = s.replace(/\[\[([^\]\n]+?)\]\]/g, function (m, inner) {
      var bits = inner.split(/\\?\|/);
      var target = bits[0].trim();
      var label = (bits[1] || target).trim();
      var id = resolve(target);
      if (id) {
        return '<a class="wikilink" href="#/' + encPath(id) + '" data-id="' + esc(id) + '">' + esc(label) + '</a>';
      }
      return '<span class="broken-link" title="尚未建页">' + esc(label) + '</span>';
    });
    return s;
  }

  /* ---------- 侧栏 ---------- */
  function renderNav(filter) {
    var nav = $('#nav');
    var mf = state.manifest;
    var q = (filter || '').trim().toLowerCase();
    var html = '';
    var shown = 0;
    mf.categories.forEach(function (cat) {
      var items = cat.pages.filter(function (id) {
        if (!q) return true;
        var p = state.byId[id];
        var hay = (p.title + ' ' + (p.aliases || []).join(' ') + ' ' + (p.heads || []).join(' ') + ' ' + cat.name).toLowerCase();
        return hay.indexOf(q) > -1;
      });
      if (!items.length) return;
      html += '<div class="cat-title">' + esc(cat.name) + '</div>';
      items.forEach(function (id) {
        var p = state.byId[id];
        shown++;
        html += '<a class="nav-link' + (id === state.current ? ' active' : '') + '" href="#/' + encPath(id) + '" data-id="' + esc(id) + '">'
          + '<span class="dot ' + statusClass(p.status) + '"></span>' + esc(p.title) + '</a>';
      });
    });
    if (!shown) html = '<div class="nav-empty">没有匹配的页面</div>';
    nav.innerHTML = html;
  }

  function statusClass(st) {
    if (!st) return '';
    if (st.indexOf('草稿') > -1 || st.indexOf('存疑') > -1) return 'draft';
    if (st.indexOf('定稿') > -1) return 'done';
    if (st.indexOf('待') > -1 || st.indexOf('未') > -1) return 'warn';
    return '';
  }

  /* ---------- 路由 ---------- */
  function currentId() {
    var h = decodeURIComponent((location.hash || '').replace(/^#\/?/, ''));
    return h.replace(/^\/+|\/+$/g, '');
  }

  function go(id) {
    if (!id) { location.hash = '#/'; return; }
    location.hash = '#/' + encPath(id);
  }

  function route() {
    if ((location.hash || '').indexOf('#sec-') === 0) return;   // 目录锚点，交给浏览器滚动
    var id = currentId();
    if (!id) { renderHome(); return; }
    if (!state.byId[id]) { renderMissing(id); return; }
    loadPage(id);
  }

  function loadPage(id) {
    state.current = id;
    renderNav($('#search').value);
    $('#md-link').href = CONTENT + encPath(id) + '.md';
    $('#article').innerHTML = '<div class="welcome">载入中…</div>';
    fetchMd(id).then(function (res) {
      if (state.current !== id) return;
      var p = state.byId[id];
      var bodyHtml;
      if (res.kind === 'md') {
        bodyHtml = renderMarkdown(splitFront(res.text).body);
      } else {
        bodyHtml = res.text;   // 回退：已在站点上的旧页面正文
      }
      var catName = (state.manifest.catOf[id] || '');
      var html = '<div class="page-head">'
        + '<div class="crumb">' + esc(catName || '页面') + '</div>'
        + '<h1 class="page-title">' + esc(p.title) + '</h1>'
        + metas(p)
        + '</div>'
        + bodyHtml
        + backlinks(id);
      $('#article').innerHTML = html;
      fixArticle();
      document.title = p.title + ' · 溯回纪元 wiki';
      window.scrollTo(0, 0);
      updateProgress();
    }).catch(function (e) {
      $('#article').innerHTML = '<div class="welcome">页面载入失败：' + esc(e.message) + '</div>';
    });
  }

  function metas(p) {
    var chips = '';
    if (p.status) chips += '<span class="chip status">' + esc(p.status) + '</span>';
    if (p.type) chips += '<span class="chip">' + esc(p.type) + '</span>';
    if (p.updated) chips += '<span class="chip">' + esc(p.updated) + '</span>';
    (p.tags || []).forEach(function (t) { chips += '<span class="chip">#' + esc(t) + '</span>'; });
    return chips ? '<div class="metas">' + chips + '</div>' : '';
  }

  function backlinks(id) {
    var ins = (state.byId[id].inlinks || []).filter(function (x) { return state.byId[x]; });
    if (!ins.length) return '';
    var li = ins.map(function (src) {
      return '<li><a class="wikilink" href="#/' + encPath(src) + '">' + esc(state.byId[src].title) + '</a></li>';
    }).join('');
    return '<div class="backlinks"><h3>反向链接（谁提到了本页）</h3><ul>' + li + '</ul></div>';
  }

  function fixArticle() {
    var art = $('#article');
    // 任务清单样式
    var lis = art.querySelectorAll('li');
    for (var i = 0; i < lis.length; i++) {
      if (lis[i].querySelector('input[type="checkbox"]')) lis[i].classList.add('task');
    }
    // 宽表格加横向滚动容器
    var tables = art.querySelectorAll('table');
    for (var t = 0; t < tables.length; t++) {
      var tb = tables[t];
      if (tb.parentNode.className === 'tw') continue;
      var wrap = document.createElement('div');
      wrap.className = 'tw';
      tb.parentNode.insertBefore(wrap, tb);
      wrap.appendChild(tb);
    }
    // 外链新窗口
    var as = art.querySelectorAll('a[href^="http"]');
    for (var j = 0; j < as.length; j++) { as[j].target = '_blank'; as[j].rel = 'noopener'; }
    // 站内链接：关闭移动端侧栏
    var wl = art.querySelectorAll('a.wikilink, .backlinks a');
    for (var k = 0; k < wl.length; k++) {
      wl[k].addEventListener('click', function () { document.body.classList.remove('nav-open'); });
    }
    buildToc(art);
  }

  /* ---------- 本页目录 / 锚点 / 阅读进度 ---------- */
  function buildToc(art) {
    var toc = $('#toc');
    toc.innerHTML = '<div class="toc-title">本页目录</div>';
    var hs = art.querySelectorAll('h2, h3');
    var links = [];
    for (var i = 0; i < hs.length; i++) {
      var h = hs[i];
      var id = 'sec-' + i;
      h.setAttribute('id', id);
      if (!h.querySelector('.heading-anchor')) {
        var a = document.createElement('a');
        a.className = 'heading-anchor';
        a.href = '#' + id;
        a.textContent = '#';
        h.appendChild(a);
      }
      var item = document.createElement('a');
      item.href = '#' + id;
      item.className = h.tagName === 'H3' ? 'lv3' : '';
      item.textContent = h.textContent.replace(/#$/, '').trim();
      toc.appendChild(item);
      links.push({ el: item, target: h });
    }
    if (!links.length) { toc.style.display = 'none'; return; }
    toc.style.display = '';
    if (state.observer) state.observer.disconnect();
    state.observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        links.forEach(function (l) { l.el.classList.toggle('on', l.target === e.target); });
      });
    }, { rootMargin: '-10% 0px -80% 0px' });
    links.forEach(function (l) { state.observer.observe(l.target); });
  }

  function updateProgress() {
    var h = document.documentElement;
    var max = h.scrollHeight - h.clientHeight;
    var p = max > 0 ? (h.scrollTop || document.body.scrollTop) / max : 0;
    $('#progress').style.width = (p * 100).toFixed(2) + '%';
    $('#to-top').classList.toggle('show', (h.scrollTop || document.body.scrollTop) > 400);
  }

  function renderHome() {
    state.current = null;
    renderNav('');
    var mf = state.manifest;
    var ids = Object.keys(mf.pages);
    var done = ids.filter(function (id) { return /定稿/.test(state.byId[id].status || ''); }).length;
    var html = '<div class="hero">'
      + '<h1>溯回纪元</h1>'
      + '<p class="sub">设定知识库 · 现实世界无法容纳之物，都记在这里</p>'
      + '<div class="stats">'
      + '<div class="stat"><div class="v">' + ids.length + '</div><div class="k">条目</div></div>'
      + '<div class="stat"><div class="v">' + mf.categories.length + '</div><div class="k">分类</div></div>'
      + '<div class="stat"><div class="v">' + done + '</div><div class="k">定稿</div></div>'
      + '<div class="stat"><div class="v">' + esc(mf.updated || '') + '</div><div class="k">最近更新</div></div>'
      + '</div></div>'
      + '<div class="cat-grid">';
    mf.categories.forEach(function (cat) {
      html += '<div class="cat-card"><h3>' + esc(cat.name) + '<span>' + cat.pages.length + '</span></h3><div class="chips">';
      cat.pages.forEach(function (id) {
        var p = state.byId[id];
        html += '<a class="chip-link" href="#/' + encPath(id) + '" title="' + esc(p.sum || '') + '">' + esc(p.title) + '</a>';
      });
      html += '</div></div>';
    });
    html += '</div>';
    $('#article').innerHTML = html;
    document.title = '溯回纪元 · 设定 wiki';
    fixArticle();
    updateProgress();
  }

  function renderMissing(id) {
    renderNav('');
    $('#article').innerHTML = '<div class="page-head"><h1 class="page-title">页面不存在</h1></div>'
      + '<p>没有找到 <code>' + esc(id) + '</code>。它可能尚未建页，或已被重命名。</p>'
      + '<p><a href="./#/">返回首页</a></p>';
    document.title = '页面不存在 · 溯回纪元 wiki';
  }

  /* ---------- 取内容：优先 markdown，缺失时回退到已上线页面 ---------- */
  function fetchMd(id) {
    if (state.cache[id]) return Promise.resolve({ kind: 'md', text: state.cache[id] });
    return fetch(CONTENT + encPath(id) + '.md').then(function (r) {
      if (r.ok) return r.text().then(function (t) {
        state.cache[id] = t;
        return { kind: 'md', text: t };
      });
      // markdown 还没上线（或缺失）时，回退到站点上已有的同名页面，抽取正文
      return fetch('./wiki/' + encPath(id) + '.html').then(function (r2) {
        if (!r2.ok) throw new Error('HTTP ' + r.status);
        return r2.text();
      }).then(function (html) {
        return { kind: 'html', text: extractLegacy(html) };
      });
    });
  }

  // 从旧导出页面里取出正文并清洗（标题折叠箭头、代码块复制按钮等）
  function extractLegacy(html) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var sec = doc.querySelector('.markdown-preview-section, .markdown-sections, .markdown-preview-view');
    var root = sec || doc.body;
    var junk = root.querySelectorAll('.heading-collapse-indicator, .copy-code-button, script, style, .metadata-container, .embedded-backlinks');
    for (var i = 0; i < junk.length; i++) junk[i].remove();
    var links = root.querySelectorAll('a.internal-link[data-href], a.internal-link');
    for (var j = 0; j < links.length; j++) {
      var a = links[j];
      var name = a.getAttribute('data-href') || a.textContent.trim();
      var tid = resolve(name) || resolve((name || '').split('/').pop());
      a.setAttribute('href', tid ? '#/' + encPath(tid) : './#/');
      a.removeAttribute('target');
      a.classList.add('wikilink');
    }
    var ext = root.querySelectorAll('a[href^="http"]');
    for (var k = 0; k < ext.length; k++) { ext[k].setAttribute('target', '_blank'); ext[k].setAttribute('rel', 'noopener'); }
    return root.innerHTML;
  }

  /* ---------- 全文搜索（按需加载） ---------- */
  var fullTextTimer = null;
  var searchSeq = 0;
  function addFullTextResults(q) {
    var seq = ++searchSeq;
    var ids = Object.keys(state.byId);
    var hits = [];
    var i = 0;
    function step() {
      if (seq !== searchSeq) return;                 // 输入已变化，放弃
      if (i >= ids.length || hits.length >= 12) return show(searchSeq === seq);
      var id = ids[i++];
      fetchMd(id).then(function (res) {
        if (seq !== searchSeq) return;
        var text = res.kind === 'md' ? res.text : res.text.replace(/<[^>]+>/g, ' ');
        var idx = text.toLowerCase().indexOf(q);
        if (idx > -1) {
          hits.push({ id: id, snippet: text.slice(Math.max(0, idx - 40), idx + 90).replace(/\n+/g, ' ') });
        }
        step();
      }).catch(function () { step(); });
    }
    function show() {
      var nav = $('#nav');
      if (!hits.length) return;
      if (nav.querySelector('.ft-block')) return;
      var block = document.createElement('div');
      block.className = 'ft-block';
      var html = '<div class="cat-title">正文命中</div>';
      hits.forEach(function (h) {
        html += '<a class="nav-link" href="#/' + encPath(h.id) + '" title="' + esc(h.snippet) + '">'
          + esc(state.byId[h.id].title) + '<div class="snip">…' + esc(h.snippet.slice(0, 60)) + '…</div></a>';
      });
      block.innerHTML = html;
      nav.appendChild(block);
    }
    step();
  }

  function initSearch() {
    var input = $('#search');
    input.addEventListener('input', function () {
      var q = input.value;
      renderNav(q);
      clearTimeout(fullTextTimer);
      if (q.trim().length >= 2) fullTextTimer = setTimeout(function () { addFullTextResults(q.trim().toLowerCase()); }, 350);
    });
  }

  /* ---------- 启动 ---------- */
  function boot() {
    initTheme();
    fetch(MANIFEST).then(function (r) {
      if (!r.ok) throw new Error('manifest HTTP ' + r.status);
      return r.json();
    }).then(function (mf) {
      state.manifest = mf;
      buildMap(mf.pages);
      $('#page-count').textContent = Object.keys(mf.pages).length + ' 页';
      initSearch();
      window.addEventListener('hashchange', route);
      window.addEventListener('scroll', updateProgress, { passive: true });
      $('#sidebar-toggle').addEventListener('click', function () { document.body.classList.toggle('nav-open'); });
      $('#backdrop').addEventListener('click', function () { document.body.classList.remove('nav-open'); });
      $('#to-top').addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });
      route();
    }).catch(function (e) {
      $('#nav').innerHTML = '<div class="nav-empty">目录载入失败：' + esc(e.message) + '</div>';
      $('#article').innerHTML = '<div class="welcome"><h1>目录载入失败</h1><p>' + esc(e.message)
        + '</p><p>如果直接用 file:// 打开也会这样——请通过站点网址访问。</p></div>';
    });
  }

  boot();
})();
