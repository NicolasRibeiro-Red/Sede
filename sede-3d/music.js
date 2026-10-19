// Official, visible embeds; provider callbacks, never a button click, confirm playback.
const FAVORITES_KEY = 'sede.music.favorites.v1';
const providers = {spotify: 'Spotify', youtube: 'YouTube Music'};
let spotifyApi = null, spotifyLoading = null, youtubeLoading = null;

export function parseMusicUrl(value) {
  const text = String(value || '').trim();
  if (text.length > 2048) throw new Error('Esse link é longo demais. Cole o link compartilhado da playlist.');
  let url; try {url = new URL(text);} catch {throw new Error('Cole um link completo do Spotify ou YouTube Music.');}
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('Use um link HTTPS oficial do Spotify ou YouTube Music.');
  const host = url.hostname.toLowerCase();
  if (host === 'open.spotify.com') {
    const match = url.pathname.match(/^\/(?:intl-[a-z]{2}\/)?(playlist|album|track)\/([A-Za-z0-9]{22})\/?$/);
    if (!match) throw new Error('Use o link de uma playlist, álbum ou faixa do Spotify.');
    return {provider: 'spotify', type: match[1], id: match[2], uri: `spotify:${match[1]}:${match[2]}`, url: `https://open.spotify.com/${match[1]}/${match[2]}`};
  }
  if (!['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'].includes(host)) throw new Error('Este player aceita apenas links oficiais do Spotify e do YouTube.');
  const list = url.searchParams.get('list'), listPath = ['/playlist', '/watch'].includes(url.pathname);
  if (list && listPath && /^[A-Za-z0-9_-]{10,150}$/.test(list)) return {provider: 'youtube', type: 'playlist', id: list, url: `https://music.youtube.com/playlist?list=${list}`};
  const id = host === 'youtu.be' ? url.pathname.slice(1) : url.pathname === '/watch' ? url.searchParams.get('v') : url.pathname.match(/^\/(?:shorts|embed)\/([A-Za-z0-9_-]{11})\/?$/)?.[1];
  if (!/^[A-Za-z0-9_-]{11}$/.test(id || '')) throw new Error('Não encontrei uma playlist ou faixa nesse link do YouTube.');
  return {provider: 'youtube', type: 'track', id, url: `https://music.youtube.com/watch?v=${id}`};
}

function loadProvider(provider) {
  if (provider === 'spotify' && spotifyApi) return Promise.resolve(spotifyApi);
  if (provider === 'youtube' && window.YT?.Player) return Promise.resolve(window.YT);
  if (provider === 'spotify' && spotifyLoading) return spotifyLoading;
  if (provider === 'youtube' && youtubeLoading) return youtubeLoading;
  const promise = new Promise((resolve, reject) => {
    const callback = provider === 'spotify' ? 'onSpotifyIframeApiReady' : 'onYouTubeIframeAPIReady', previous = window[callback];
    const script = document.createElement('script'); script.async = true;
    script.src = provider === 'spotify' ? 'https://open.spotify.com/embed/iframe-api/v1' : 'https://www.youtube.com/iframe_api';
    const cleanup = () => {clearTimeout(timeout); if (window[callback] === ready) window[callback] = previous;};
    const fail = () => {cleanup(); script.remove(); reject(new Error('Não foi possível conectar o player. Abra a música no app ou tente novamente.'));};
    const ready = api => {cleanup(); if (provider === 'spotify') spotifyApi = api; try {previous?.(api);} catch {} resolve(provider === 'spotify' ? api : window.YT);};
    const timeout = setTimeout(fail, 15000); window[callback] = ready; script.addEventListener('error', fail, {once: true}); document.head.append(script);
  });
  const retryable = promise.catch(error => {if (provider === 'spotify') spotifyLoading = null; else youtubeLoading = null; throw error;});
  if (provider === 'spotify') spotifyLoading = retryable; else youtubeLoading = retryable; return retryable;
}

/** A 32-second original, deterministic lounge sketch; no sample or recording. */
export function createHouseAudioBuffer(context) {
  const rate = 22050, duration = 32, buffer = context.createBuffer(1, rate * duration, rate), samples = buffer.getChannelData(0);
  const chords = [[48,55,59,62,64], [45,52,55,59,62], [50,57,60,64,65], [43,50,53,57,64]], frequency = note => 440 * 2 ** ((note - 69) / 12);
  for (let i = 0; i < samples.length; i++) {
    const t = i / rate, chord = chords[Math.floor(t / 4) % 4], beat = t % .5, note = chord[Math.floor(t / .5) % chord.length] + 12;
    const attack = Math.min(1, beat / .012), bell = Math.sin(2 * Math.PI * frequency(note) * beat) + .24 * Math.sin(4 * Math.PI * frequency(note) * beat);
    const bassTime = t % 2, bass = Math.sin(2 * Math.PI * frequency(chord[0] - 12) * bassTime) * Math.min(1, bassTime / .03) * Math.exp(-bassTime * 2);
    const pad = (Math.sin(2 * Math.PI * frequency(chord[1]) * t) + Math.sin(2 * Math.PI * frequency(chord[2]) * t)) * Math.min(1, (t % 4) / .15, (4 - t % 4) / .3);
    samples[i] = (.13 * bell * attack * Math.exp(-beat * 7) + .19 * bass + .035 * pad) * Math.min(1, t / .25, (duration - t) / .7);
  }
  return buffer;
}

export function createMusicPlayer({onPlaybackChange = () => {}} = {}) {
  const doc = document, node = (tag, text, cls) => {const el = doc.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el;};
  const button = (text, action, cls) => {const el = node('button', text, cls); el.type = 'button'; el.addEventListener('click', action); return el;};
  let disposed = false, opened = false, minimized = false, previousFocus = null, generation = 0, controller = null, poll = null, readyTimeout = null;
  let context = null, master = null, houseBuffer = null, houseSource = null, houseActive = false, youtubeState = -1, favorites = [];
  let state = {playing: false, source: null, status: 'idle', volume: .18, url: null, title: 'Som para uma pausa.'}, lastNotice = '';
  try {const saved = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]'); if (Array.isArray(saved)) favorites = [...new Set(saved.filter(item => typeof item === 'string').flatMap(item => {try {return [parseMusicUrl(item).url];} catch {return [];}}))].slice(0, 8);} catch {}
  const element = node('aside', undefined, 'music-panel'); element.id = 'music-panel'; element.hidden = true; element.setAttribute('aria-labelledby', 'music-title');
  const header = node('div', undefined, 'music-header'), heading = node('div');
  const title = node('h2', 'Música'); title.id = 'music-title'; heading.append(node('span', 'THE WAIT PUB', 'music-eyebrow'), title);
  const headerActions = node('div', undefined, 'music-header-actions');
  const minimizeButton = button('−', () => setMinimized(!minimized), 'music-icon'); minimizeButton.id = 'music-minimize'; minimizeButton.setAttribute('aria-label', 'Minimizar player e continuar no campus');
  const closeButton = button('×', close, 'music-icon'); closeButton.id = 'music-close'; closeButton.setAttribute('aria-label', 'Parar música e fechar'); headerActions.append(minimizeButton, closeButton); header.append(heading, headerActions);
  const content = node('div', undefined, 'music-content'), intro = node('p', 'Sua playlist, uma boa conversa e nenhuma pressa.', 'music-intro');
  const form = node('form', undefined, 'music-form'), label = node('label', 'Link do Spotify ou YouTube Music'), input = node('input'); input.type = 'url'; input.id = 'music-url'; input.placeholder = 'https://…'; input.autocomplete = 'off'; input.maxLength = 2048; label.htmlFor = input.id;
  const formActions = node('div', undefined, 'music-form-actions'), loadButton = button('Abrir player', () => loadUrl(input.value), 'music-primary'); loadButton.id = 'music-load';
  const favoriteButton = button('Favoritar', saveFavorite, 'music-secondary'); favoriteButton.id = 'music-save'; formActions.append(loadButton, favoriteButton); form.append(label, input, formActions); form.addEventListener('submit', event => {event.preventDefault(); loadUrl(input.value);});
  const favoriteList = node('div', undefined, 'music-favorites'); favoriteList.id = 'music-favorites';
  const houseCard = node('section', undefined, 'music-house'), houseCopy = node('div'); houseCopy.append(node('strong', 'Depois do último prompt'), node('span', 'Faixa da casa · lounge original · 32 s'));
  const houseButton = button('Ouvir faixa da casa', playHouse, 'music-secondary'); houseButton.id = 'music-house-play'; houseCard.append(houseCopy, houseButton);
  const status = node('p', undefined, 'music-status'); status.id = 'music-status'; status.setAttribute('role', 'status');
  const embed = node('div', undefined, 'music-embed'); embed.id = 'music-embed'; embed.hidden = true;
  const transport = node('div', undefined, 'music-transport'), pauseButton = button('Pausar', pause, 'music-secondary'); pauseButton.id = 'music-pause';
  const volumeLabel = node('label', undefined, 'music-volume'), volume = node('input'), volumeValue = node('output', '18%'); volume.type = 'range'; volume.id = 'music-volume'; volume.min = 0; volume.max = 100; volume.step = 1; volume.value = 18; volume.setAttribute('aria-label', 'Volume da música'); volumeLabel.append(node('span', 'Volume'), volume, volumeValue); volume.addEventListener('input', () => setVolume(Number(volume.value) / 100)); transport.append(pauseButton, volumeLabel);
  const fallback = node('a', 'Abrir no app de música', 'music-fallback'); fallback.id = 'music-fallback'; fallback.target = '_blank'; fallback.rel = 'noopener noreferrer'; fallback.hidden = true;
  const note = node('p', 'Os players oficiais podem pedir login, exibir anúncios ou limitar o conteúdo. A faixa da casa funciona sem conta. No Spotify, ajuste o volume no próprio player.', 'music-note');
  content.append(intro, form, favoriteList, houseCard, status, embed, transport, fallback, note); element.append(header, content); doc.body.append(element);

  function getState() {return {...state, open: opened, minimized, favorites: [...favorites]};}
  function announce(playing, statusText, message) {
    state.playing = Boolean(playing && opened && !disposed && !doc.hidden); state.status = statusText;
    if (message) status.textContent = message; element.dataset.playing = String(state.playing); element.dataset.source = state.source || '';
    pauseButton.disabled = !state.playing && !houseActive && !controller; volumeLabel.hidden = state.source === 'spotify';
    fallback.hidden = !state.url; if (state.url) {fallback.href = state.url; fallback.textContent = `Abrir no ${providers[state.source] || 'app de música'} ↗`;}
    const next = JSON.stringify([state.playing, state.source, state.status, state.volume, state.url]);
    if (next !== lastNotice) {lastNotice = next; onPlaybackChange({...state});}
  }
  function stopHouse() {houseActive = false; if (houseSource) {houseSource.onended = null; try {houseSource.stop();} catch {} houseSource.disconnect(); houseSource = null;}}
  function clearPlayer() {
    generation++; clearInterval(poll); poll = null; clearTimeout(readyTimeout); readyTimeout = null; stopHouse();
    if (controller) {try {controller.pause?.(); controller.pauseVideo?.(); controller.destroy?.();} catch {} controller = null;}
    embed.replaceChildren(); embed.hidden = true; youtubeState = -1;
  }
  function fail(message) {announce(false, 'error', message);}
  function validSession(token) {return token === generation && opened && !disposed;}
  function readYoutube() {
    if (state.source !== 'youtube' || !controller) return;
    try {const muted = state.volume === 0 || controller.isMuted?.() || controller.getVolume?.() === 0; const confirmed = youtubeState === 1 && controller.getPlayerState?.() === 1; announce(confirmed && !muted, muted ? 'muted' : confirmed ? 'playing' : state.status, muted ? 'Player sem som. A dança está em pausa.' : confirmed ? 'Tocando no YouTube Music.' : undefined);} catch {}
  }
  async function loadUrl(value) {
    if (disposed) return false;
    let parsed; try {parsed = parseMusicUrl(value);} catch (error) {status.textContent = error.message; return false;}
    if (!opened) open(); clearPlayer(); const token = generation; state = {...state, source: parsed.provider, volume: parsed.provider === 'spotify' ? null : Number(volume.value) / 100, url: parsed.url, title: `${providers[parsed.provider]} · ${parsed.type === 'playlist' ? 'playlist' : parsed.type === 'album' ? 'álbum' : 'faixa'}`}; input.value = parsed.url;
    announce(false, 'loading', 'Conectando o player oficial…'); embed.hidden = false; embed.dataset.provider = parsed.provider;
    const mount = node('div'); mount.id = `music-provider-${token}`; embed.append(mount);
    try {
      const api = await loadProvider(parsed.provider); if (!validSession(token)) return false;
      readyTimeout = setTimeout(() => {if (validSession(token)) fail('O player não respondeu. Tente abrir este link no app de música.');}, 16000);
      if (parsed.provider === 'spotify') {
        api.createController(mount, {uri: parsed.uri, width: '100%', height: 352}, player => {
          if (!validSession(token)) {player.destroy?.(); return;} controller = player;
          player.addListener('ready', () => {if (!validSession(token)) return; clearTimeout(readyTimeout); announce(false, 'ready', 'Player pronto. Dê play nos controles do Spotify.');});
          player.addListener('playback_started', () => {if (validSession(token)) announce(true, 'playing', 'Reprodução confirmada pelo Spotify.');});
          player.addListener('playback_update', event => {if (!validSession(token)) return; const info = event.data || {}, playing = info.isPaused === false && info.isBuffering !== true; announce(playing, info.isBuffering ? 'buffering' : playing ? 'playing' : 'paused', info.isBuffering ? 'Carregando a música…' : playing ? 'Tocando no Spotify.' : 'Spotify em pausa.');});
        });
      } else {
        const playerVars = {playsinline: 1, controls: 1, autoplay: 0, origin: window.location.origin}; if (parsed.type === 'playlist') Object.assign(playerVars, {listType: 'playlist', list: parsed.id});
        controller = new api.Player(mount, {width: '100%', height: 240, ...(parsed.type === 'track' ? {videoId: parsed.id} : {}), playerVars, events: {
          onReady: event => {if (!validSession(token)) {event.target.destroy?.(); return;} clearTimeout(readyTimeout); event.target.setVolume(Math.round(state.volume * 100)); announce(false, 'ready', 'Player pronto. Dê play nos controles do YouTube.');},
          onStateChange: event => {if (!validSession(token)) return; youtubeState = event.data; if (event.data === 1) readYoutube(); else announce(false, event.data === 3 ? 'buffering' : event.data === 0 ? 'ended' : 'paused', event.data === 3 ? 'Carregando a música…' : event.data === 0 ? 'A faixa terminou.' : 'YouTube em pausa.');},
          onError: event => {if (!validSession(token)) return; youtubeState = -1; fail(`Este conteúdo não pôde tocar aqui (código ${event.data}). Use “Abrir no YouTube Music”.`);},
          onAutoplayBlocked: () => {if (!validSession(token)) return; youtubeState = -1; announce(false, 'blocked', 'O navegador bloqueou a reprodução automática. Dê play no player visível.');}
        }});
        poll = setInterval(() => {if (validSession(token)) readYoutube();}, 500);
      }
      return true;
    } catch (error) {if (validSession(token)) fail(error.message); return false;}
  }
  async function playHouse() {
    if (disposed) return false; if (!opened) open(); clearPlayer(); const token = generation;
    state = {...state, source: 'house', volume: Number(volume.value) / 100, url: null, title: 'Depois do último prompt'}; announce(false, 'loading', 'Preparando a faixa da casa…');
    try {
      const Audio = window.AudioContext || window.webkitAudioContext; if (!Audio) throw new Error('Este navegador não oferece áudio local. Use um dos players acima.');
      if (!context || context.state === 'closed') {context = new Audio(); master = context.createGain(); master.connect(context.destination); context.onstatechange = () => {if (state.source === 'house' && houseActive) announce(context.state === 'running' && state.volume > 0, context.state === 'running' ? 'playing' : 'paused', context.state === 'running' ? 'Tocando: Depois do último prompt.' : 'Áudio pausado pelo navegador.');};}
      await context.resume(); if (!validSession(token)) return false;
      houseBuffer ||= createHouseAudioBuffer(context); houseSource = context.createBufferSource(); houseSource.buffer = houseBuffer; houseSource.connect(master); master.gain.value = state.volume;
      houseSource.onended = () => {if (!validSession(token) || !houseActive) return; houseActive = false; houseSource = null; announce(false, 'ended', 'A faixa da casa terminou. Que tal mais uma rodada?');};
      houseActive = true; houseSource.start(); announce(context.state === 'running' && state.volume > 0, state.volume ? 'playing' : 'muted', state.volume ? 'Tocando: Depois do último prompt · original da casa.' : 'Volume em zero. A dança está em pausa.'); return true;
    } catch (error) {if (validSession(token)) {stopHouse(); fail(error.message);} return false;}
  }
  function setVolume(value) {
    if (!Number.isFinite(value)) return; state.volume = Math.max(0, Math.min(1, value)); volume.value = Math.round(state.volume * 100); volumeValue.textContent = `${volume.value}%`;
    if (master) master.gain.setTargetAtTime(state.volume, context.currentTime, .03);
    if (state.source === 'youtube') {try {controller?.setVolume(Math.round(state.volume * 100));} catch {} readYoutube();}
    else if (state.source === 'house') announce(houseActive && context?.state === 'running' && state.volume > 0, state.volume === 0 ? 'muted' : houseActive ? 'playing' : 'paused', state.volume === 0 ? 'Volume em zero. A dança está em pausa.' : houseActive ? 'Tocando: Depois do último prompt.' : 'Faixa da casa em pausa.');
  }
  function pause() {
    if (disposed) return; stopHouse(); try {controller?.pause?.(); controller?.pauseVideo?.();} catch {} youtubeState = 2; announce(false, 'paused', 'Música em pausa.');
  }
  function saveFavorite() {
    let parsed; try {parsed = parseMusicUrl(input.value);} catch (error) {status.textContent = error.message; return;}
    favorites = [parsed.url, ...favorites.filter(url => url !== parsed.url)].slice(0, 8); persistFavorites(); renderFavorites(); status.textContent = 'Link salvo neste navegador.';
  }
  function persistFavorites() {try {localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));} catch {status.textContent = 'Não foi possível salvar os favoritos neste navegador.';}}
  function renderFavorites() {
    favoriteList.replaceChildren(); if (!favorites.length) return;
    favoriteList.append(node('span', 'Seus favoritos', 'music-eyebrow'));
    for (const url of favorites) {const parsed = parseMusicUrl(url), row = node('div', undefined, 'music-favorite'); const play = button(`${providers[parsed.provider]} · ${parsed.id.slice(-6)}`, () => loadUrl(url), 'music-favorite-link'); play.title = url; const remove = button('×', () => {favorites = favorites.filter(item => item !== url); persistFavorites(); renderFavorites();}, 'music-remove'); remove.setAttribute('aria-label', `Remover favorito do ${providers[parsed.provider]}`); row.append(play, remove); favoriteList.append(row);}
  }
  function setMinimized(value) {minimized = Boolean(value); element.dataset.minimized = String(minimized); minimizeButton.textContent = minimized ? '+' : '−'; minimizeButton.setAttribute('aria-label', minimized ? 'Expandir player' : 'Minimizar player e continuar no campus'); if (minimized && previousFocus?.isConnected) previousFocus.focus({preventScroll: true});}
  function open() {if (disposed) return false; if (!opened) previousFocus = doc.activeElement; opened = true; element.hidden = false; setMinimized(false); closeButton.focus({preventScroll: true}); return true;}
  function close() {if (!opened || disposed) return false; pause(); clearPlayer(); opened = false; element.hidden = true; if (previousFocus?.isConnected) previousFocus.focus({preventScroll: true}); return true;}
  function onKey(event) {if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); close();}}
  function onVisibility() {if (doc.hidden) pause();}
  element.addEventListener('keydown', onKey); doc.addEventListener('visibilitychange', onVisibility); renderFavorites(); status.textContent = 'Escolha uma playlist ou experimente a faixa da casa.';
  return {element, open, close, getState, pause,
    dispose() {if (disposed) return; close(); clearPlayer(); disposed = true; context?.close().catch(() => {}); context = null; houseBuffer = null; element.removeEventListener('keydown', onKey); doc.removeEventListener('visibilitychange', onVisibility); element.remove();}
  };
}
