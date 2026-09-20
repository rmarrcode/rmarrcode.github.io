/* ============================================================
   tex.js — a small LaTeX -> HTML renderer.

   Handles the macro subset used by the résumé and the project
   write-ups in tex/, and emits the same markup/classes that
   resume.html uses, so a .tex file renders in the site's own
   typographic system.

   Supported:
     \documentclass \usepackage \title \author \date \maketitle
     \begin{document} \section \subsection \subsubsection \paragraph
     itemize / enumerate / description / quote / abstract / center
     verbatim / lstlisting / figure (with \caption, \includegraphics)
     \item  \resumeItem  \resumeSubItem
     \resumeWorkHeading  \resumeSubheading  \resumeProjectHeading
     \textbf \textit \emph \texttt \underline \textsc \href \url
     inline math $...$ with ^ _ and common Greek/logic symbols
     LaTeX quoting (`` '' --- --), ~, \\, escaped specials, % comments

   Public API:  TeX.render(source) -> { title, author, date, html }
   ============================================================ */

var TeX = (function () {
    'use strict';

    var SYMBOLS = {
        forall: '∀', exists: '∃', neg: '¬', lnot: '¬',
        land: '∧', wedge: '∧', lor: '∨', vee: '∨',
        implies: '⇒', Rightarrow: '⇒', rightarrow: '→', to: '→',
        leftarrow: '←', leftrightarrow: '↔', mapsto: '↦',
        vdash: '⊢', models: '⊨', in: '∈', notin: '∉',
        subseteq: '⊆', subset: '⊂', cup: '∪', cap: '∩',
        emptyset: '∅', infty: '∞', partial: '∂', nabla: '∇',
        sum: '∑', prod: '∏', int: '∫', sqrt: '√',
        times: '×', cdot: '·', cdots: '⋯', ldots: '…', dots: '…',
        approx: '≈', equiv: '≡', neq: '≠', leq: '≤', geq: '≥',
        ll: '≪', gg: '≫', pm: '±', circ: '∘', propto: '∝',
        alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ',
        epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
        theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ',
        mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ',
        sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ',
        varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
        Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ',
        Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ',
        Psi: 'Ψ', Omega: 'Ω',
        LaTeX: 'LaTeX', TeX: 'TeX', textbackslash: '\\',
        quad: ' ', qquad: '  ', hfill: ' · ', bullet: '•',
        copyright: '©', dag: '†', ddag: '‡', S: '§', P: '¶'
    };

    var WRAPS = {
        textbf: ['<strong>', '</strong>'],
        bf: ['<strong>', '</strong>'],
        textit: ['<em>', '</em>'],
        emph: ['<em>', '</em>'],
        it: ['<em>', '</em>'],
        texttt: ['<code>', '</code>'],
        tt: ['<code>', '</code>'],
        underline: ['<u>', '</u>'],
        textsc: ['<span style="font-variant:small-caps">', '</span>'],
        textsuperscript: ['<sup>', '</sup>'],
        textsubscript: ['<sub>', '</sub>'],
        mbox: ['', ''],
        text: ['', ''],
        mathrm: ['', ''],
        textrm: ['', ''],
        mathbf: ['<strong>', '</strong>']
    };

    /* macros whose arguments are dropped entirely */
    var DROP_ARGS = {
        label: 1, ref: 0, cite: 0, pagestyle: 1, thispagestyle: 1, vspace: 1,
        hspace: 1, addtolength: 2, setlength: 2, renewcommand: 2, newcommand: 2,
        titleformat: 5, titlerule: 0, hyphenation: 1, urlstyle: 1, index: 1,
        fancyhf: 1, fancyfoot: 1, fancyhead: 1, color: 1, definecolor: 3
    };

    /* no-argument macros that simply vanish */
    var DROP_BARE = [
        'maketitle', 'tableofcontents', 'newpage', 'clearpage', 'pagebreak',
        'noindent', 'indent', 'bigskip', 'medskip', 'smallskip', 'centering',
        'raggedright', 'raggedbottom', 'raggedleft', 'small', 'footnotesize',
        'scriptsize', 'tiny', 'large', 'Large', 'LARGE', 'huge', 'Huge',
        'normalsize', 'scshape', 'itshape', 'bfseries', 'mdseries', 'rmfamily',
        'sffamily', 'ttfamily', 'linebreak', 'par', 'hrule', 'titlerule',
        'resumeSubHeadingListStart', 'resumeSubHeadingListEnd',
        'resumeItemListStart', 'resumeItemListEnd',
        'resumeNoBulletListStart', 'resumeNoBulletListEnd'
    ];

    var verbatims = [];

    function esc(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    function escAttr(s) {
        return esc(s).replace(/"/g, '&quot;');
    }
    function typo(s) {
        return esc(s)
            .replace(/---/g, '—')
            .replace(/--/g, '–')
            .replace(/``/g, '“')
            .replace(/''/g, '”')
            .replace(/~/g, ' ');
    }
    function slug(s) {
        return stripTex(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    }
    function stripTex(s) {
        return String(s).replace(/\\[a-zA-Z]+\s*/g, '').replace(/[{}$]/g, '').trim();
    }

    /* ---------- brace-matched argument reading ---------- */

    function readArg(src, i) {
        while (i < src.length && /\s/.test(src[i])) i++;
        if (src[i] !== '{') return { value: '', next: i, found: false };
        var depth = 1, j = i + 1, out = '';
        while (j < src.length && depth > 0) {
            var c = src[j];
            if (c === '\\' && j + 1 < src.length) { out += c + src[j + 1]; j += 2; continue; }
            if (c === '{') depth++;
            if (c === '}') { depth--; if (depth === 0) { j++; break; } }
            out += c; j++;
        }
        return { value: out, next: j, found: true };
    }

    function readOpt(src, i) {
        var k = i;
        while (k < src.length && /\s/.test(src[k])) k++;
        if (src[k] !== '[') return { value: null, next: i };
        var depth = 1, j = k + 1, out = '';
        while (j < src.length && depth > 0) {
            if (src[j] === '[') depth++;
            if (src[j] === ']') { depth--; if (depth === 0) { j++; break; } }
            out += src[j]; j++;
        }
        return { value: out, next: j };
    }

    /* ---------- inline math ---------- */

    function math(s) {
        var out = '', i = 0;
        while (i < s.length) {
            var c = s[i];
            if (c === '\\') {
                var m = /^\\([a-zA-Z]+)/.exec(s.slice(i));
                if (m) {
                    out += SYMBOLS[m[1]] !== undefined ? esc(SYMBOLS[m[1]]) : esc(m[1]);
                    i += m[0].length;
                    continue;
                }
                out += esc(s[i + 1] || ''); i += 2; continue;
            }
            if (c === '^' || c === '_') {
                var tag = c === '^' ? 'sup' : 'sub';
                var r = readArg(s, i + 1);
                var body = r.found ? r.value : (s[i + 1] || '');
                out += '<' + tag + '>' + math(body) + '</' + tag + '>';
                i = r.found ? r.next : i + 2;
                continue;
            }
            if (c === '{' || c === '}') { i++; continue; }
            out += esc(c); i++;
        }
        return out;
    }

    /* ---------- inline text ---------- */

    function inline(src) {
        var out = '', buf = '', i = 0;
        function flush() { if (buf) { out += typo(buf); buf = ''; } }

        while (i < src.length) {
            var c = src[i];

            if (c === '$') {
                var display = src[i + 1] === '$';
                var close = src.indexOf(display ? '$$' : '$', i + (display ? 2 : 1));
                if (close === -1) { buf += c; i++; continue; }
                flush();
                var body = src.slice(i + (display ? 2 : 1), close);
                out += '<span class="math">' + math(body) + '</span>';
                i = close + (display ? 2 : 1);
                continue;
            }

            if (c !== '\\') { buf += c; i++; continue; }

            var next = src[i + 1];
            if (next === undefined) { i++; continue; }
            if ('%&_#${}'.indexOf(next) !== -1) { buf += next; i += 2; continue; }
            if (next === '\\') { flush(); out += '<br>'; i += 2; continue; }
            if (next === ' ') { buf += ' '; i += 2; continue; }

            var m = /^\\([a-zA-Z]+)\*?/.exec(src.slice(i));
            if (!m) { i++; continue; }
            var name = m[1];
            var j = i + m[0].length;
            flush();

            if (name === 'href') {
                var u = readArg(src, j);
                var t = readArg(src, u.next);
                out += '<a href="' + escAttr(stripTex(u.value)) + '">' + inline(t.value) + '</a>';
                i = t.next; continue;
            }
            if (name === 'url') {
                var uu = readArg(src, j);
                var href = stripTex(uu.value);
                out += '<a href="' + escAttr(href) + '">' + esc(href.replace(/^https?:\/\//, '')) + '</a>';
                i = uu.next; continue;
            }
            if (name === 'includegraphics') {
                var o = readOpt(src, j), g = readArg(src, o.next);
                out += '<img src="' + escAttr(g.value.trim()) + '" alt="">';
                i = g.next; continue;
            }
            if (name === 'footnote') {
                var f = readArg(src, j);
                out += '<span class="note"> (' + inline(f.value) + ')</span>';
                i = f.next; continue;
            }
            if (name === 'resumeItem' || name === 'resumeSubItem') {
                var ra = readArg(src, j), rb = readArg(src, ra.next);
                out += '<span class="term">' + inline(ra.value).replace(/[.:]\s*$/, '') +
                    '.</span> ' + inline(rb.value);
                i = rb.next; continue;
            }
            if (WRAPS[name]) {
                var w = readArg(src, j);
                if (!w.found) { i = j; continue; }
                out += WRAPS[name][0] + inline(w.value) + WRAPS[name][1];
                i = w.next; continue;
            }
            if (Object.prototype.hasOwnProperty.call(DROP_ARGS, name)) {
                var k = j;
                for (var n = 0; n < DROP_ARGS[name]; n++) {
                    var opt = readOpt(src, k);
                    k = readArg(src, opt.next).next;
                }
                i = k; continue;
            }
            if (SYMBOLS[name] !== undefined) { buf += SYMBOLS[name]; i = j; continue; }
            if (DROP_BARE.indexOf(name) !== -1) { i = j; continue; }

            /* unknown macro: keep its argument, drop the macro */
            var un = readArg(src, j);
            if (un.found) { out += inline(un.value); i = un.next; }
            else { i = j; }
        }
        flush();
        return out;
    }

    /* ---------- environments ---------- */

    function findEnd(src, env, from) {
        var re = new RegExp('\\\\(begin|end)\\s*\\{' + env.replace('*', '\\*') + '\\}', 'g');
        re.lastIndex = from;
        var depth = 1, m;
        while ((m = re.exec(src)) !== null) {
            depth += m[1] === 'begin' ? 1 : -1;
            if (depth === 0) return { start: m.index, next: re.lastIndex };
        }
        return { start: src.length, next: src.length };
    }

    /* \resumeItem and the heading macros each expand to an \item, so they
       start a new list entry just as \item does. */
    var ITEM_BOUNDARY = /^\\(item|resumeItem|resumeSubItem|resumeWorkHeading|resumeSubheading|resumeProjectHeading)\b/;
    var BARE_ITEM = /^\\(resumeWorkHeading|resumeSubheading|resumeProjectHeading)\b/;

    function splitItems(body) {
        var items = [], cur = '', depth = 0, env = 0, i = 0, started = false;
        while (i < body.length) {
            if (body[i] === '\\') {
                var m = /^\\([a-zA-Z]+)/.exec(body.slice(i));
                if (m) {
                    if (m[1] === 'begin') env++;
                    else if (m[1] === 'end') env--;
                    if (depth === 0 && env === 0 && ITEM_BOUNDARY.test(body.slice(i))) {
                        if (started) items.push(cur);
                        started = true;
                        /* \item is a pure delimiter; the others carry arguments */
                        cur = m[1] === 'item' ? '' : m[0];
                        i += m[0].length;
                        continue;
                    }
                }
                cur += body[i] + (body[i + 1] || ''); i += 2; continue;
            }
            if (body[i] === '{') depth++;
            if (body[i] === '}') depth--;
            cur += body[i]; i++;
        }
        if (started || cur.trim()) items.push(cur);
        return items;
    }

    function itemBody(chunk) {
        var t = chunk.trim();
        var r = /^\\(resumeItem|resumeSubItem)\s*\{/.exec(t);
        if (r) {
            var a = readArg(t, r[0].length - 1);
            var b = readArg(t, a.next);
            var term = inline(a.value).replace(/[.:]\s*$/, '');
            var rest = b.value + t.slice(b.next);
            return '<span class="term">' + term + '.</span> ' + inline(rest);
        }
        if (/\\begin\s*\{|\\section|\\subsection/.test(t)) return blocks(t);
        return inline(t);
    }

    function list(body, tag, cls) {
        var items = splitItems(body);
        var html = '<' + tag + (cls ? ' class="' + cls + '"' : '') + '>';
        for (var i = 0; i < items.length; i++) {
            var chunk = items[i];
            if (!chunk.trim()) continue;
            /* a job/section heading is a list entry structurally, but takes no bullet */
            if (BARE_ITEM.test(chunk.trim())) {
                html += '<li class="bare">' + blocks(chunk) + '</li>';
                continue;
            }
            var label = '';
            var opt = readOpt(chunk, 0);
            if (opt.value !== null) {
                label = '<span class="term">' + inline(opt.value) + '</span> ';
                chunk = chunk.slice(opt.next);
            }
            html += '<li>' + label + itemBody(chunk) + '</li>';
        }
        return html + '</' + tag + '>';
    }

    function environment(env, body) {
        switch (env) {
            case 'itemize': return list(body, 'ul', 'items');
            case 'enumerate': return list(body, 'ol', '');
            case 'description': return list(body, 'ul', 'items');
            case 'quote':
            case 'quotation': return '<blockquote>' + blocks(body) + '</blockquote>';
            case 'abstract': return '<div class="tex-abstract">' + blocks(body) + '</div>';
            case 'center': return '<div class="tex-center">' + blocks(body) + '</div>';
            case 'figure':
            case 'figure*': {
                var cap = '';
                var cm = /\\caption\s*\{/.exec(body);
                if (cm) {
                    var c = readArg(body, cm.index + cm[0].length - 1);
                    cap = '<figcaption>' + inline(c.value) + '</figcaption>';
                    body = body.slice(0, cm.index) + body.slice(c.next);
                }
                return '<figure>' + blocks(body) + cap + '</figure>';
            }
            case 'document': return blocks(body);
            case 'tabular':
            case 'tabular*':
            case 'table': return blocks(body);
            default: return blocks(body);
        }
    }

    /* ---------- block-level macros inside a paragraph ---------- */

    function entryHead(org, meta, sub1, sub2) {
        var html = '<div class="entry-head"><span class="org">' + inline(org) + '</span>';
        if (meta && meta.trim()) html += '<span class="meta">' + inline(meta) + '</span>';
        html += '</div>';
        var sub = [];
        if (sub1 && sub1.trim()) sub.push(inline(sub1));
        if (sub2 && sub2.trim()) sub.push(inline(sub2));
        if (sub.length) html += '<div class="entry-sub">' + sub.join(' · ') + '</div>';
        return html;
    }

    function wrapP(text) {
        if (!text || !text.trim()) return '';
        var inner = inline(text.trim());
        return inner.replace(/<[^>]*>/g, '').trim() || /<(img|br|a|code)\b/.test(inner)
            ? '<p>' + inner + '</p>'
            : '';
    }

    function para(p) {
        p = p.trim();
        if (!p) return '';

        var vm = /^\u0000V(\d+)\u0000$/.exec(p);
        if (vm) return '<pre>' + esc(verbatims[+vm[1]]) + '</pre>';

        var out = '', pos = 0, m;
        var re = /\\(resumeWorkHeading|resumeSubheading|resumeProjectHeading)\s*\{/g;
        while ((m = re.exec(p)) !== null) {
            out += wrapP(p.slice(pos, m.index));
            var a = readArg(p, m.index + m[0].length - 1);
            var b = readArg(p, a.next);
            if (m[1] === 'resumeSubheading') {
                var c = readArg(p, b.next), d = readArg(p, c.next);
                out += entryHead(a.value, b.value, c.value, d.value);
                pos = d.next;
            } else {
                out += entryHead(a.value, b.value);
                pos = b.next;
            }
            re.lastIndex = pos;
        }
        out += wrapP(p.slice(pos));
        return out;
    }

    function paragraphs(text) {
        if (!text || !text.trim()) return '';
        var parts = text.split(/\n\s*\n/);
        var out = '';
        for (var i = 0; i < parts.length; i++) out += para(parts[i]);
        return out;
    }

    function blocks(src) {
        var out = '', pos = 0, m;
        var re = /\\(section|subsection|subsubsection|paragraph)\*?\s*\{|\\begin\s*\{([A-Za-z*]+)\}/g;
        while ((m = re.exec(src)) !== null) {
            out += paragraphs(src.slice(pos, m.index));
            if (m[1]) {
                var r = readArg(src, m.index + m[0].length - 1);
                var tag = { section: 'h2', subsection: 'h3', subsubsection: 'h4', paragraph: 'h4' }[m[1]];
                out += '<' + tag + ' id="' + escAttr(slug(r.value)) + '">' + inline(r.value) + '</' + tag + '>';
                pos = r.next;
            } else {
                var env = m[2];
                var opt = readOpt(src, re.lastIndex);
                var e = findEnd(src, env, opt.next);
                out += environment(env, src.slice(opt.next, e.start));
                pos = e.next;
            }
            re.lastIndex = pos;
        }
        out += paragraphs(src.slice(pos));
        return out;
    }

    /* ---------- entry point ---------- */

    function render(source) {
        verbatims = [];
        var src = String(source).replace(/\r\n?/g, '\n');

        /* protect verbatim before comments are stripped */
        src = src.replace(
            /\\begin\s*\{(verbatim|lstlisting)\}(?:\[[^\]]*\])?([\s\S]*?)\\end\s*\{\1\}/g,
            function (_, env, body) {
                verbatims.push(body.replace(/^\n/, '').replace(/\s+$/, ''));
                return '\n\n\u0000V' + (verbatims.length - 1) + '\u0000\n\n';
            }
        );

        /* strip comments (but not \%) */
        src = src.replace(/(^|[^\\])%.*$/gm, '$1');

        /* the résumé's custom list delimiters expand to itemize */
        src = src
            .replace(/\\resume(?:ItemList|SubHeadingList|NoBulletList)Start\b/g, '\n\\begin{itemize}\n')
            .replace(/\\resume(?:ItemList|SubHeadingList|NoBulletList)End\b/g, '\n\\end{itemize}\n');

        /* metadata */
        function meta(name) {
            var mm = new RegExp('\\\\' + name + '\\s*\\{').exec(src);
            if (!mm) return '';
            return readArg(src, mm.index + mm[0].length - 1).value;
        }
        var title = meta('title'), author = meta('author'), date = meta('date');

        /* body */
        var b = /\\begin\s*\{document\}/.exec(src);
        if (b) {
            var end = findEnd(src, 'document', b.index + b[0].length);
            src = src.slice(b.index + b[0].length, end.start);
        }

        /* preamble leftovers that may appear anywhere */
        src = src.replace(/\\(documentclass|usepackage)\s*(\[[^\]]*\])?\s*\{[^}]*\}/g, '');
        src = src.replace(/\\(title|author|date)\s*\{(?:[^{}]|\{[^{}]*\})*\}/g, '');

        return {
            title: title ? inline(title) : '',
            titleText: stripTex(title),
            author: author ? inline(author) : '',
            date: date ? inline(date) : '',
            html: blocks(src)
        };
    }

    return { render: render, inline: inline, escape: esc };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = TeX;
