/* Handbook interactivity: theme toggle, mobile nav, scroll-spy TOC, client-side search.
   No dependencies — everything here is plain DOM. */

;(function () {
  'use strict'

  // --- theme -------------------------------------------------------------

  var root = document.documentElement
  var themeToggle = document.getElementById('theme-toggle')

  function currentTheme() {
    var explicit = root.getAttribute('data-theme')
    if (explicit) return explicit
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }

  if (themeToggle) {
    themeToggle.addEventListener('click', function () {
      var next = currentTheme() === 'dark' ? 'light' : 'dark'
      root.setAttribute('data-theme', next)
      try {
        localStorage.setItem('docs-theme', next)
      } catch (e) {
        /* private mode — the toggle still works for this page load */
      }
    })
  }

  // --- mobile navigation -------------------------------------------------

  var menuToggle = document.getElementById('menu-toggle')
  var sidebar = document.getElementById('sidebar')
  var scrim = document.getElementById('sidebar-scrim')

  function setNav(open) {
    if (!sidebar) return
    sidebar.classList.toggle('is-open', open)
    if (scrim) scrim.hidden = !open
    if (menuToggle) menuToggle.setAttribute('aria-expanded', String(open))
  }

  if (menuToggle) {
    menuToggle.addEventListener('click', function () {
      setNav(!sidebar.classList.contains('is-open'))
    })
  }
  if (scrim) scrim.addEventListener('click', function () { setNav(false) })

  // --- scroll-spy for the "On this page" rail ----------------------------

  var tocLinks = Array.prototype.slice.call(document.querySelectorAll('.toc a'))
  if (tocLinks.length) {
    var targets = tocLinks
      .map(function (a) { return document.getElementById(a.getAttribute('href').slice(1)) })
      .filter(Boolean)

    var spy = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return
          tocLinks.forEach(function (a) {
            a.classList.toggle('is-current', a.getAttribute('href') === '#' + entry.target.id)
          })
        })
      },
      // Top-biased band: a heading counts as "current" once it reaches the upper
      // third of the viewport, which matches where the eye actually is while reading.
      { rootMargin: '-72px 0px -70% 0px', threshold: 0 },
    )
    targets.forEach(function (t) { spy.observe(t) })
  }

  // --- wide tables get their own scroll container ------------------------

  Array.prototype.forEach.call(document.querySelectorAll('.prose table'), function (table) {
    var wrap = document.createElement('div')
    wrap.className = 'table-scroll'
    table.parentNode.insertBefore(wrap, table)
    wrap.appendChild(table)
  })

  // --- search ------------------------------------------------------------

  var input = document.getElementById('search-input')
  var results = document.getElementById('search-results')
  if (!input || !results) return

  var index = null
  var activeIndex = -1
  var hits = []

  function loadIndex() {
    if (index) return Promise.resolve(index)
    return fetch('search-index.json')
      .then(function (r) { return r.json() })
      .then(function (data) {
        index = data
        return index
      })
      .catch(function () {
        index = []
        return index
      })
  }

  input.addEventListener('focus', loadIndex)

  function score(page, terms) {
    var title = page.title.toLowerCase()
    var text = page.text.toLowerCase()
    var headings = page.headings.map(function (h) { return h.text.toLowerCase() }).join(' ')
    var total = 0

    for (var i = 0; i < terms.length; i++) {
      var term = terms[i]
      // Every term must appear somewhere, otherwise this is not a match at all.
      if (title.indexOf(term) === -1 && headings.indexOf(term) === -1 && text.indexOf(term) === -1) {
        return 0
      }
      if (title.indexOf(term) !== -1) total += 10
      if (headings.indexOf(term) !== -1) total += 4
      if (text.indexOf(term) !== -1) total += 1
    }
    return total
  }

  /** Deepest heading whose text matches, so a hit can link into the page, not just at it. */
  function anchorFor(page, terms) {
    for (var i = 0; i < page.headings.length; i++) {
      var h = page.headings[i].text.toLowerCase()
      for (var j = 0; j < terms.length; j++) {
        if (h.indexOf(terms[j]) !== -1) return '#' + page.headings[i].id
      }
    }
    return ''
  }

  function render(query) {
    var terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    if (!terms.length || !index) {
      results.hidden = true
      results.innerHTML = ''
      hits = []
      return
    }

    hits = index
      .map(function (page) { return { page: page, score: score(page, terms) } })
      .filter(function (h) { return h.score > 0 })
      .sort(function (a, b) { return b.score - a.score })
      .slice(0, 8)
      .map(function (h) {
        return { url: h.page.slug + '.html' + anchorFor(h.page, terms), page: h.page }
      })

    activeIndex = -1
    results.hidden = false

    if (!hits.length) {
      results.innerHTML = '<p class="sr-empty">No matches.</p>'
      return
    }

    results.innerHTML = hits
      .map(function (h) {
        return (
          '<a href="' + h.url + '" role="option">' +
          '<span class="sr-section">' + h.page.section + '</span>' +
          '<span class="sr-title">' + h.page.title + '</span>' +
          '</a>'
        )
      })
      .join('')
  }

  input.addEventListener('input', function () {
    loadIndex().then(function () { render(input.value) })
  })

  input.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      input.value = ''
      render('')
      input.blur()
      return
    }
    if (!hits.length) return

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      activeIndex += event.key === 'ArrowDown' ? 1 : -1
      if (activeIndex < 0) activeIndex = hits.length - 1
      if (activeIndex >= hits.length) activeIndex = 0
      Array.prototype.forEach.call(results.children, function (child, i) {
        child.classList.toggle('is-active', i === activeIndex)
      })
      return
    }
    if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault()
      window.location.href = hits[activeIndex].url
    }
  })

  document.addEventListener('click', function (event) {
    if (!results.hidden && !event.target.closest('.topbar__search')) results.hidden = true
  })

  // "/" focuses search, the way most docs sites behave.
  document.addEventListener('keydown', function (event) {
    if (event.key !== '/' || event.metaKey || event.ctrlKey) return
    var tag = document.activeElement && document.activeElement.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA') return
    event.preventDefault()
    input.focus()
  })
})()
