import { useEffect, useMemo, useState } from 'react'
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  Activity,
  Bot,
  CalendarDays,
  Eraser,
  ExternalLink,
  MapPin,
  Moon,
  Newspaper,
  RefreshCcw,
  Search,
  Send,
  Sparkles,
  Sun,
  Users,
  X,
} from 'lucide-react'
import {
  ArcElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip as ChartTooltip,
} from 'chart.js'
import { Doughnut, Line } from 'react-chartjs-2'
import './App.css'

ChartJS.register(ArcElement, CategoryScale, ChartTooltip, Legend, LinearScale, LineElement, PointElement)

const ISS_PROXY = 'https://api.allorigins.win/raw?url='
const ISS_NOW = `${ISS_PROXY}${encodeURIComponent('http://api.open-notify.org/iss-now.json')}`
const ASTROS = `${ISS_PROXY}${encodeURIComponent('http://api.open-notify.org/astros.json')}`
const ISS_FALLBACK = 'https://api.wheretheiss.at/v1/satellites/25544'
const ASTROS_FALLBACK = 'https://corquaid.github.io/international-space-station-APIs/JSON/people-in-space.json'
const NEWS_TTL = 15 * 60 * 1000
const MESSAGE_LIMIT = 30
const NEWS_CATEGORIES = ['Space', 'Science']

const oceanNames = [
  { name: 'Pacific Ocean', test: (lat, lon) => lon < -70 || lon > 120 },
  { name: 'Atlantic Ocean', test: (lat, lon) => lon > -70 && lon < 25 },
  { name: 'Indian Ocean', test: (lat, lon) => lon >= 25 && lon <= 120 && lat < 30 },
  { name: 'Arctic Ocean', test: (lat) => lat > 66 },
  { name: 'Southern Ocean', test: (lat) => lat < -55 },
]

const issIcon = L.divIcon({
  className: 'iss-marker',
  html: '<span>ISS</span>',
  iconSize: [52, 52],
  iconAnchor: [26, 26],
})

function readStorage(key, fallback) {
  try {
    const value = localStorage.getItem(key)
    return value ? JSON.parse(value) : fallback
  } catch {
    return fallback
  }
}

function writeStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value))
}

function haversineKm(a, b) {
  const earthRadius = 6371
  const toRad = (degrees) => (degrees * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const angle =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return earthRadius * 2 * Math.atan2(Math.sqrt(angle), Math.sqrt(1 - angle))
}

function formatTime(date) {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date)
}

function fallbackOceanName(lat, lon) {
  return oceanNames.find((ocean) => ocean.test(lat, lon))?.name ?? 'Remote area'
}

function MapUpdater({ position }) {
  const map = useMap()

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (position) {
      map.setView([position.lat, position.lon], map.getZoom(), { animate: true })
    }
  }, [map, position])

  return null
}

function Toasts({ toasts }) {
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((toast) => (
        <div className={`toast ${toast.type}`} key={toast.id}>
          {toast.message}
        </div>
      ))}
    </div>
  )
}

function SkeletonCard() {
  return (
    <article className="news-card skeleton" aria-label="Loading article">
      <div className="skeleton-img" />
      <div className="skeleton-line wide" />
      <div className="skeleton-line" />
      <div className="skeleton-line short" />
    </article>
  )
}

function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem('space-theme') || 'dark')
  const [issPositions, setIssPositions] = useState(() => readStorage('iss-positions', []))
  const [speedHistory, setSpeedHistory] = useState(() => readStorage('iss-speed-history', []))
  const [locationName, setLocationName] = useState('Locating ISS...')
  const [issLoading, setIssLoading] = useState(false)
  const [issError, setIssError] = useState('')
  const [astronauts, setAstronauts] = useState({ number: 0, people: [] })
  const [news, setNews] = useState(() => readStorage('dashboard-news', { timestamp: 0, articles: [] }).articles)
  const [newsLoading, setNewsLoading] = useState(false)
  const [newsError, setNewsError] = useState('')
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState('date')
  const [activeCategory, setActiveCategory] = useState('All')
  const [chatOpen, setChatOpen] = useState(false)
  const [messages, setMessages] = useState(() =>
    readStorage('dashboard-chat', [
      {
        role: 'assistant',
        text: 'Ask me about the ISS position, speed, astronauts, or the news currently loaded here.',
      },
    ]),
  )
  const [chatInput, setChatInput] = useState('')
  const [botTyping, setBotTyping] = useState(false)
  const [toasts, setToasts] = useState([])
  const [hasFetchedIss, setHasFetchedIss] = useState(false)

  const latestPosition = issPositions.at(-1)
  const latestSpeed = speedHistory.at(-1)?.speed ?? 0

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('space-theme', theme)
  }, [theme])

  useEffect(() => {
    writeStorage('dashboard-chat', messages.slice(-MESSAGE_LIMIT))
  }, [messages])

  useEffect(() => {
    writeStorage('iss-positions', issPositions.slice(-15))
  }, [issPositions])

  useEffect(() => {
    writeStorage('iss-speed-history', speedHistory.slice(-30))
  }, [speedHistory])

  function notify(message, type = 'info') {
    const id = crypto.randomUUID()
    setToasts((items) => [...items, { id, message, type }])
    window.setTimeout(() => {
      setToasts((items) => items.filter((item) => item.id !== id))
    }, 3200)
  }

  async function fetchJson(url, options) {
    const response = await fetch(url, options)
    if (!response.ok) throw new Error(`Request failed: ${response.status}`)
    return response.json()
  }

  async function fetchIssPosition(manual = false) {
    setIssLoading(true)
    setIssError('')
    try {
      let data
      try {
        data = await fetchJson(ISS_NOW)
      } catch {
        const fallback = await fetchJson(ISS_FALLBACK)
        data = {
          timestamp: fallback.timestamp,
          iss_position: { latitude: fallback.latitude, longitude: fallback.longitude },
        }
      }

      const next = {
        lat: Number(data.iss_position.latitude),
        lon: Number(data.iss_position.longitude),
        timestamp: Number(data.timestamp) * 1000,
      }

      setIssPositions((previous) => {
        const last = previous.at(-1)
        const updated = [...previous, next].slice(-15)
        if (last) {
          const hours = Math.max((next.timestamp - last.timestamp) / 3600000, 1 / 3600)
          const speed = haversineKm(last, next) / hours
          setSpeedHistory((history) =>
            [...history, { speed: Math.round(speed), time: formatTime(new Date(next.timestamp)) }].slice(-30),
          )
        }
        return updated
      })

      reverseGeocode(next.lat, next.lon)
      if (manual) notify('ISS location refreshed')
    } catch (error) {
      setIssError(error.message)
      if (manual) notify('Could not refresh ISS data', 'error')
    } finally {
      setIssLoading(false)
      setHasFetchedIss(true)
    }
  }

  async function reverseGeocode(lat, lon) {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=5&lat=${lat}&lon=${lon}`
      const data = await fetchJson(url, {
        headers: { Accept: 'application/json' },
      })
      const address = data.address || {}
      setLocationName(
        address.city ||
          address.town ||
          address.state ||
          address.country ||
          data.name ||
          fallbackOceanName(lat, lon),
      )
    } catch {
      setLocationName(fallbackOceanName(lat, lon))
    }
  }

  async function fetchAstronauts() {
    try {
      let data
      try {
        data = await fetchJson(ASTROS)
      } catch {
        data = await fetchJson(ASTROS_FALLBACK)
      }
      setAstronauts({
        number: data.number || data.people?.length || 0,
        people: (data.people || []).map((person) => ({
          name: person.name,
          craft: person.craft || person.spacecraft || 'Spacecraft',
        })),
      })
    } catch {
      setAstronauts({ number: 0, people: [] })
    }
  }

  function normalizeArticle(article, category, source = 'fallback') {
    return {
      id: `${source}-${category}-${article.url || article.id || article.title}`,
      category,
      title: article.title || article.name || 'Untitled article',
      source: article.source?.name || article.source?.title || article.news_site || article.provider?.[0]?.name || 'Unknown',
      author: article.author || article.authors?.[0]?.name || 'Staff reporter',
      date: article.publishedAt || article.published_at || article.dateTimePub || article.updated_at || new Date().toISOString(),
      image: article.urlToImage || article.image_url || article.image || 'https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?auto=format&fit=crop&w=900&q=80',
      description: article.description || article.summary || article.body || 'Open the full story for more details.',
      url: article.url || article.newsUrl || article.articleUrl || '#',
    }
  }

  async function fetchNews(category, force = false) {
    const cache = readStorage(`news-${category}`, { timestamp: 0, articles: [] })
    if (!force && Date.now() - cache.timestamp < NEWS_TTL && cache.articles.length) {
      return cache.articles
    }

    const apiKey = import.meta.env.VITE_NEWS_API_KEY
    let articles = []

    if (apiKey) {
      try {
        const newsApiUrl = `https://newsapi.org/v2/everything?q=${encodeURIComponent(
          category === 'Space' ? 'space OR NASA OR ISS' : 'science OR technology',
        )}&language=en&pageSize=5&sortBy=publishedAt&apiKey=${apiKey}`
        const data = await fetchJson(newsApiUrl)
        articles = (data.articles || []).slice(0, 5).map((article) => normalizeArticle(article, category, 'newsapi'))
      } catch {
        articles = []
      }
    }

    if (!articles.length) {
      const search = category === 'Space' ? 'ISS' : 'science'
      const data = await fetchJson(`https://api.spaceflightnewsapi.net/v4/articles/?limit=5&search=${search}`)
      articles = (data.results || []).slice(0, 5).map((article) => normalizeArticle(article, category, 'spaceflight'))
    }

    writeStorage(`news-${category}`, { timestamp: Date.now(), articles })
    return articles
  }

  async function loadNews(force = false, category = null) {
    setNewsLoading(true)
    setNewsError('')
    try {
      const categories = category ? [category] : NEWS_CATEGORIES
      const results = await Promise.all(categories.map((item) => fetchNews(item, force)))
      const nextArticles = category
        ? [...news.filter((article) => article.category !== category), ...results.flat()]
        : results.flat()
      setNews(nextArticles)
      writeStorage('dashboard-news', { timestamp: Date.now(), articles: nextArticles })
      if (force) notify(category ? `${category} news refreshed` : 'News refreshed')
    } catch (error) {
      setNewsError(error.message)
      notify('News could not be loaded', 'error')
    } finally {
      setNewsLoading(false)
    }
  }

  useEffect(() => {
    fetchIssPosition()
    fetchAstronauts()
    loadNews(false)
    const timer = window.setInterval(() => fetchIssPosition(), 15000)
    const astrosTimer = window.setInterval(fetchAstronauts, 300000)
    return () => {
      window.clearInterval(timer)
      window.clearInterval(astrosTimer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  /* eslint-enable react-hooks/set-state-in-effect */

  const filteredNews = useMemo(() => {
    return news
      .filter((article) => activeCategory === 'All' || article.category === activeCategory)
      .filter((article) =>
        [article.title, article.source, article.author, article.description, article.category]
          .join(' ')
          .toLowerCase()
          .includes(query.toLowerCase()),
      )
      .sort((a, b) => {
        if (sortBy === 'source') return a.source.localeCompare(b.source)
        return new Date(b.date).getTime() - new Date(a.date).getTime()
      })
  }, [activeCategory, news, query, sortBy])

  const speedChart = useMemo(
    () => ({
      labels: speedHistory.map((item) => item.time),
      datasets: [
        {
          label: 'ISS speed km/h',
          data: speedHistory.map((item) => item.speed),
          borderColor: '#2dd4bf',
          backgroundColor: 'rgba(45, 212, 191, 0.18)',
          pointBackgroundColor: '#f97316',
          pointRadius: 4,
          tension: 0.35,
        },
      ],
    }),
    [speedHistory],
  )

  const newsDistribution = useMemo(() => {
    const counts = NEWS_CATEGORIES.map((category) => news.filter((article) => article.category === category).length)
    return {
      labels: NEWS_CATEGORIES,
      datasets: [
        {
          data: counts,
          backgroundColor: ['#2dd4bf', '#f97316'],
          borderColor: 'transparent',
          hoverOffset: 8,
        },
      ],
    }
  }, [news])

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: theme === 'dark' ? '#e5e7eb' : '#1f2937' } },
    },
    scales: {
      x: { ticks: { color: theme === 'dark' ? '#a7b0c0' : '#596579' }, grid: { color: 'rgba(148,163,184,0.15)' } },
      y: { ticks: { color: theme === 'dark' ? '#a7b0c0' : '#596579' }, grid: { color: 'rgba(148,163,184,0.15)' } },
    },
  }

  const doughnutOptions = {
    responsive: true,
    maintainAspectRatio: false,
    onClick: (_, elements) => {
      if (elements[0]) setActiveCategory(NEWS_CATEGORIES[elements[0].index])
    },
    plugins: {
      legend: { position: 'bottom', labels: { color: theme === 'dark' ? '#e5e7eb' : '#1f2937' } },
    },
  }

  function dashboardContext() {
    const headlines = news
      .slice(0, 10)
      .map((article, index) => `${index + 1}. ${article.title} (${article.category}, ${article.source})`)
      .join('\n')
    return `ISS latitude: ${latestPosition?.lat?.toFixed(4) || 'unknown'}
ISS longitude: ${latestPosition?.lon?.toFixed(4) || 'unknown'}
ISS speed: ${Math.round(latestSpeed)} km/h
ISS nearest location: ${locationName}
Tracked positions: ${issPositions.length}
People in space: ${astronauts.number}
Astronaut names: ${astronauts.people.map((person) => person.name).join(', ') || 'unavailable'}
Loaded articles: ${news.length}
News headlines:
${headlines}`
  }

  function localDashboardAnswer(question) {
    const lower = question.toLowerCase()
    if (lower.includes('speed')) {
      return `The latest ISS speed shown on this dashboard is ${Math.round(latestSpeed)} km/h.`
    }
    if (lower.includes('where') || lower.includes('location') || lower.includes('latitude') || lower.includes('longitude')) {
      return latestPosition
        ? `The ISS is near ${locationName}, at latitude ${latestPosition.lat.toFixed(4)} and longitude ${latestPosition.lon.toFixed(4)}.`
        : 'The dashboard has not loaded an ISS position yet.'
    }
    if (lower.includes('astronaut') || lower.includes('people')) {
      const names = astronauts.people.map((person) => person.name).join(', ')
      return `The dashboard currently shows ${astronauts.number} people in space${names ? `: ${names}` : '.'}`
    }
    if (lower.includes('news') || lower.includes('article') || lower.includes('headline')) {
      const headlines = filteredNews.slice(0, 5).map((article) => article.title).join('; ')
      return `There are ${news.length} loaded articles. Top visible headlines: ${headlines || 'none match the current filter.'}`
    }
    return 'I can only answer from the dashboard data: ISS location, ISS speed, astronauts, and loaded news articles.'
  }

  async function askBot(event) {
    event.preventDefault()
    const text = chatInput.trim()
    if (!text || botTyping) return
    setChatInput('')
    setMessages((items) => [...items, { role: 'user', text }].slice(-MESSAGE_LIMIT))
    setBotTyping(true)

    try {
      const token = import.meta.env.VITE_AI_TOKEN
      let answer = ''
      if (token) {
        const prompt = `<s>[INST] You are a dashboard assistant. Answer ONLY from this dashboard context. If the answer is not present, say you cannot answer from dashboard data.

Dashboard context:
${dashboardContext()}

Question: ${text} [/INST]`
        const data = await fetchJson('https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.2', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            inputs: prompt,
            parameters: { max_new_tokens: 160, temperature: 0.2, return_full_text: false },
          }),
        })
        answer = Array.isArray(data) ? data[0]?.generated_text : data.generated_text
      }
      setMessages((items) => [...items, { role: 'assistant', text: answer || localDashboardAnswer(text) }].slice(-MESSAGE_LIMIT))
    } catch {
      setMessages((items) => [...items, { role: 'assistant', text: localDashboardAnswer(text) }].slice(-MESSAGE_LIMIT))
    } finally {
      setBotTyping(false)
    }
  }

  return (
    <main className="app-shell">
      <Toasts toasts={toasts} />
      <header className="topbar">
        <div>
          <p className="eyebrow">Orbital live desk</p>
          <h1>ISS Tracker, News, and Data-Locked AI</h1>
        </div>
        <button className="icon-button" type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle theme">
          {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
        </button>
      </header>

      <section className="hero-grid">
        <div className="panel map-panel">
          <div className="section-title">
            <div>
              <p className="eyebrow">Live position</p>
              <h2>International Space Station</h2>
            </div>
            <button className="ghost-button" type="button" onClick={() => fetchIssPosition(true)} disabled={issLoading}>
              <RefreshCcw size={16} />
              Refresh
            </button>
          </div>
          {issError && (
            <div className="error-box">
              <span>{issError}</span>
              <button type="button" onClick={() => fetchIssPosition(true)}>Retry</button>
            </div>
          )}
          <div className="map-wrap">
            {latestPosition ? (
              <MapContainer center={[latestPosition.lat, latestPosition.lon]} zoom={3} scrollWheelZoom className="iss-map">
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <MapUpdater position={latestPosition} />
                <Polyline positions={issPositions.map((item) => [item.lat, item.lon])} color="#f97316" weight={3} />
                <Marker position={[latestPosition.lat, latestPosition.lon]} icon={issIcon}>
                  <Tooltip>
                    ISS at {latestPosition.lat.toFixed(2)}, {latestPosition.lon.toFixed(2)}
                  </Tooltip>
                </Marker>
              </MapContainer>
            ) : (
              <div className="map-loading">Loading orbital map...</div>
            )}
          </div>
        </div>

        <div className="metrics-grid">
          <div className="metric-card">
            <MapPin size={22} />
            <span>Latitude / Longitude</span>
            <strong>{latestPosition ? `${latestPosition.lat.toFixed(4)}, ${latestPosition.lon.toFixed(4)}` : '--'}</strong>
          </div>
          <div className="metric-card">
            <Activity size={22} />
            <span>Speed</span>
            <strong>{latestSpeed ? `${Math.round(latestSpeed).toLocaleString()} km/h` : hasFetchedIss ? 'Measuring' : '--'}</strong>
          </div>
          <div className="metric-card">
            <MapPin size={22} />
            <span>Nearest place</span>
            <strong>{locationName}</strong>
          </div>
          <div className="metric-card">
            <CalendarDays size={22} />
            <span>Positions tracked</span>
            <strong>{issPositions.length} / 15</strong>
          </div>
          <div className="panel astronauts">
            <div className="section-title compact">
              <h2>People in Space</h2>
              <Users size={20} />
            </div>
            <strong>{astronauts.number || 'Unknown'}</strong>
            <div className="chips">
              {astronauts.people.length ? astronauts.people.map((person) => <span key={person.name}>{person.name}</span>) : <span>Names unavailable</span>}
            </div>
          </div>
        </div>
      </section>

      <section className="charts-grid">
        <div className="panel chart-card">
          <div className="section-title">
            <h2>ISS Speed Trend</h2>
            <Activity size={20} />
          </div>
          <div className="chart-box">
            <Line data={speedChart} options={chartOptions} />
          </div>
        </div>
        <div className="panel chart-card">
          <div className="section-title">
            <h2>News Distribution</h2>
            <Newspaper size={20} />
          </div>
          <div className="chart-box doughnut">
            <Doughnut data={newsDistribution} options={doughnutOptions} />
          </div>
        </div>
      </section>

      <section className="panel news-panel">
        <div className="news-header">
          <div>
            <p className="eyebrow">Latest articles</p>
            <h2>News Dashboard</h2>
          </div>
          <div className="news-actions">
            {NEWS_CATEGORIES.map((category) => (
              <button className="ghost-button" key={category} type="button" onClick={() => loadNews(true, category)} disabled={newsLoading}>
                <RefreshCcw size={15} />
                {category}
              </button>
            ))}
          </div>
        </div>

        {newsError && (
          <div className="error-box">
            <span>{newsError}</span>
            <button type="button" onClick={() => loadNews(true)}>Retry</button>
          </div>
        )}

        <div className="filters">
          <label className="search-box">
            <Search size={18} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search articles" />
          </label>
          <select value={sortBy} onChange={(event) => setSortBy(event.target.value)} aria-label="Sort articles">
            <option value="date">Sort by date</option>
            <option value="source">Sort by source</option>
          </select>
          <select value={activeCategory} onChange={(event) => setActiveCategory(event.target.value)} aria-label="Filter category">
            <option value="All">All categories</option>
            {NEWS_CATEGORIES.map((category) => (
              <option value={category} key={category}>{category}</option>
            ))}
          </select>
        </div>

        <div className="news-grid">
          {newsLoading && !news.length
            ? Array.from({ length: 6 }).map((_, index) => <SkeletonCard key={index} />)
            : filteredNews.map((article) => (
                <article className="news-card" key={article.id}>
                  <img src={article.image} alt="" loading="lazy" />
                  <div className="article-body">
                    <div className="article-meta">
                      <span>{article.category}</span>
                      <span>{article.source}</span>
                    </div>
                    <h3>{article.title}</h3>
                    <p>{article.description}</p>
                    <div className="article-footer">
                      <span>{article.author} · {new Date(article.date).toLocaleDateString()}</span>
                      <a href={article.url} target="_blank" rel="noreferrer">
                        Read More <ExternalLink size={14} />
                      </a>
                    </div>
                  </div>
                </article>
              ))}
        </div>
      </section>

      <button className="chat-fab" type="button" onClick={() => setChatOpen(true)} aria-label="Open chatbot">
        <Bot size={24} />
      </button>

      {chatOpen && (
        <aside className="chat-window" aria-label="Dashboard chatbot">
          <div className="chat-head">
            <div>
              <span><Sparkles size={16} /> Data-only AI</span>
              <small>Mistral-7B-Instruct-v0.2 when token is configured</small>
            </div>
            <button className="icon-button small" type="button" onClick={() => setChatOpen(false)} aria-label="Close chat">
              <X size={18} />
            </button>
          </div>
          <div className="messages">
            {messages.map((message, index) => (
              <div className={`message ${message.role}`} key={`${message.role}-${index}`}>
                {message.text}
              </div>
            ))}
            {botTyping && <div className="typing">Thinking from dashboard data...</div>}
          </div>
          <form className="chat-form" onSubmit={askBot}>
            <button className="icon-button small" type="button" onClick={() => setMessages([])} aria-label="Clear chat">
              <Eraser size={18} />
            </button>
            <input value={chatInput} onChange={(event) => setChatInput(event.target.value)} placeholder="Ask about ISS or news" />
            <button className="icon-button small accent" type="submit" aria-label="Send message">
              <Send size={18} />
            </button>
          </form>
        </aside>
      )}
    </main>
  )
}

export default App
