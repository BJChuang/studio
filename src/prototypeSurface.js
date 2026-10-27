// Extracted from prototypeSurface.ts; runs without TypeScript or Vue.
const UI_EVENTS = new Set(['click', 'dblclick', 'contextmenu', 'input', 'beforeinput', 'change', 'submit', 'reset', 'keydown', 'keyup', 'keypress', 'pointerdown', 'pointerup', 'pointermove', 'pointercancel', 'pointerover', 'pointerout', 'pointerenter', 'pointerleave', 'mousedown', 'mouseup', 'mousemove', 'mouseover', 'mouseout', 'mouseenter', 'mouseleave', 'touchstart', 'touchmove', 'touchend', 'touchcancel', 'wheel', 'focusin', 'focusout', 'dragstart', 'drag', 'dragover', 'dragenter', 'dragleave', 'drop', 'dragend', 'copy', 'cut', 'paste', 'selectstart', 'selectionchange']);
const WINDOW_METHODS = new Set(['getComputedStyle', 'matchMedia', 'getSelection', 'atob', 'btoa', 'fetch', 'open', 'close', 'focus', 'blur', 'print', 'alert', 'confirm', 'prompt', 'scroll', 'scrollTo', 'scrollBy', 'postMessage', 'reportError', 'queueMicrotask']);
const UNAVAILABLE_MODULE_GLOBALS = new Set(['module', 'exports', 'define', 'require']);
// These native events do not cross the shadow boundary. Capturing listeners
// still need to observe lazy panels, internal scroll and pointer cancellation.
const INTERNAL_DOM_EVENTS = new Set(['toggle', 'beforetoggle', 'scroll', 'lostpointercapture', 'gotpointercapture', 'creator-layout']);
/** Only localization of public media is added to a preview frame's policy. */
export function localizeFramePolicy(markup, origin) {
    if (!markup.includes('/creator-prototype/assets/'))
        return markup;
    const directory = `${origin}/creator-prototype/assets/`;
    return markup.replace(/<meta\b[^>]*>/gi, tag => {
        if (!/http-equiv\s*=\s*["']?content-security-policy\b/i.test(tag))
            return tag;
        return tag.replace(/(\bcontent\s*=\s*)(["'])([\s\S]*?)\2/i, (_match, prefix, quote, policy) => {
            const directives = policy.split(';').map(part => part.trim()).filter(Boolean);
            for (const name of ['img-src', 'media-src', 'font-src']) {
                const index = directives.findIndex(part => part.split(/\s/)[0]?.toLowerCase() === name);
                if (index < 0)
                    directives.push(`${name} ${directory}`);
                else {
                    const tokens = directives[index].split(/\s+/).filter(token => token !== "'none'");
                    if (!tokens.includes(directory))
                        tokens.push(directory);
                    directives[index] = tokens.join(' ');
                }
            }
            return `${prefix}${quote}${directives.join('; ')}${quote}`;
        });
    });
}
export function createPrototypeSurface(host, markup) {
    const realDocument = host.ownerDocument;
    const realWindow = realDocument.defaultView || window;
    const root = host.shadowRoot || host.attachShadow({ mode: 'open' });
    root.replaceChildren();
    const html = realDocument.createElement('html');
    const head = realDocument.createElement('head');
    const body = realDocument.createElement('body');
    for (const [element, attributes] of [[html, markup.htmlAttributes], [head, markup.headAttributes], [body, markup.bodyAttributes]]) {
        for (const [name, value] of Object.entries(attributes || {}))
            element.setAttribute(name, value);
    }
    const baseline = realDocument.createElement('style');
    baseline.textContent = ':host{display:block;width:100%;height:100%;min-width:0;contain:layout paint style;isolation:isolate}html{display:block;width:100%;min-height:100%;height:100%;overflow:hidden}body{display:block;margin:0;min-height:100%;height:100%}html,body{box-sizing:border-box}';
    head.innerHTML = markup.headMarkup;
    body.innerHTML = markup.bodyMarkup;
    html.append(head, body);
    root.append(baseline, html);
    let active = true;
    let started = false;
    const local = new Map();
    const readyTarget = new EventTarget();
    const records = [];
    const timeoutIds = new Set();
    const intervalIds = new Set();
    const animationIds = new Set();
    const objectUrls = new Set();
    const media = new Set();
    const audioContexts = new Set();
    const onHandlers = new Map();
    const boundMethods = new Map();
    const installedFrames = new WeakSet();
    const fonts = realDocument.createElement('style');
    fonts.dataset.creatorPrototypeFonts = '';
    realDocument.head.append(fonts);
    let scope;
    let documentScope;
    function framePolicy(frame) {
        if (installedFrames.has(frame))
            return;
        installedFrames.add(frame);
        const descriptor = Object.getOwnPropertyDescriptor(realWindow.HTMLIFrameElement.prototype, 'srcdoc');
        if (descriptor?.get && descriptor.set) {
            Object.defineProperty(frame, 'srcdoc', {
                configurable: true,
                get: () => descriptor.get.call(frame),
                set: value => descriptor.set.call(frame, localizeFramePolicy(String(value), realWindow.location.origin)),
            });
        }
        const original = frame.setAttribute.bind(frame);
        frame.setAttribute = (name, value) => original(name, name.toLowerCase() === 'srcdoc' ? localizeFramePolicy(value, realWindow.location.origin) : value);
        const source = frame.getAttribute('srcdoc');
        if (source) {
            const localized = localizeFramePolicy(source, realWindow.location.origin);
            if (source !== localized)
                original('srcdoc', localized);
        }
    }
    function prepareNode(node) {
        if (node.nodeType !== Node.ELEMENT_NODE)
            return;
        const element = node;
        if (element.tagName === 'IFRAME')
            framePolicy(element);
        for (const frame of element.querySelectorAll('iframe'))
            framePolicy(frame);
        if (element.tagName === 'STYLE')
            normalizeStyle(element);
        for (const style of element.querySelectorAll('style'))
            normalizeStyle(style);
        if (element.tagName === 'AUDIO' || element.tagName === 'VIDEO')
            media.add(element);
        for (const item of element.querySelectorAll('audio,video'))
            media.add(item);
    }
    function normalizeStyle(style) {
        if (style === baseline)
            return;
        const source = style.textContent || '';
        const localized = source.replace(/:root\b/g, 'html');
        if (localized !== source)
            style.textContent = localized;
    }
    function syncFonts() {
        const rules = new Set();
        for (const style of root.querySelectorAll('style')) {
            for (const rule of (style.textContent || '').matchAll(/@font-face\s*\{[^}]*\}/gi))
                rules.add(rule[0]);
        }
        const source = [...rules].join('\n');
        if (fonts.textContent !== source)
            fonts.textContent = source;
    }
    prepareNode(html);
    syncFonts();
    const observer = new MutationObserver(mutations => {
        if (!active)
            return;
        let styleChanged = false;
        for (const mutation of mutations) {
            if (mutation.type === 'childList')
                for (const node of mutation.addedNodes) {
                    prepareNode(node);
                    if (node.nodeType === Node.ELEMENT_NODE && (node.matches('style') || node.querySelector('style')))
                        styleChanged = true;
                }
            if (mutation.type === 'characterData' && mutation.target.parentElement?.tagName === 'STYLE') {
                normalizeStyle(mutation.target.parentElement);
                styleChanged = true;
            }
            if (mutation.type === 'attributes' && mutation.target.tagName === 'IFRAME') {
                const frame = mutation.target;
                framePolicy(frame);
                const source = frame.getAttribute('srcdoc') || '';
                const localized = localizeFramePolicy(source, realWindow.location.origin);
                if (localized !== source)
                    frame.setAttribute('srcdoc', localized);
            }
        }
        if (styleChanged)
            syncFonts();
    });
    observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['srcdoc'] });
    function eventProxy(event, kind) {
        return new Proxy(event, { get(target, key) {
                const value = Reflect.get(target, key, target);
                if (key === 'source' && value === realWindow)
                    return scope;
                if (key === 'currentTarget')
                    return kind === 'document' ? documentScope : scope;
                return typeof value === 'function' ? value.bind(target) : value;
            } });
    }
    function eventTarget(kind, type, capture = false) {
        if (type === 'DOMContentLoaded' || type === 'load' && kind === 'window')
            return readyTarget;
        if (kind === 'document')
            return type === 'visibilitychange' || type === 'selectionchange' ? realDocument : html;
        if (capture && (type === 'blur' || type === 'focus'))
            return root;
        return UI_EVENTS.has(type) || INTERNAL_DOM_EVENTS.has(type) ? root : realWindow;
    }
    function add(kind, type, listener, options) {
        if (!listener)
            return;
        const capture = typeof options === 'boolean' ? options : !!options?.capture;
        const target = eventTarget(kind, type, capture);
        if (records.some(record => record.kind === kind && record.target === target && record.type === type && record.original === listener && record.capture === capture))
            return;
        const wrapper = event => {
            if (!active)
                return;
            if (type === 'selectionchange' && realDocument.activeElement !== host)
                return;
            const scopedEvent = eventProxy(event, kind);
            if (typeof listener === 'function')
                listener.call(kind === 'document' ? documentScope : scope, scopedEvent);
            else
                listener.handleEvent(scopedEvent);
        };
        records.push({ kind, target, type, original: listener, wrapper, capture });
        target.addEventListener(type, wrapper, options);
    }
    function remove(kind, type, listener, options) {
        const capture = typeof options === 'boolean' ? options : !!options?.capture;
        const target = eventTarget(kind, type, capture);
        for (let index = records.length - 1; index >= 0; index--) {
            const record = records[index];
            if (record.kind === kind && record.target === target && record.type === type && record.original === listener && record.capture === capture) {
                target.removeEventListener(type, record.wrapper, record.capture);
                records.splice(index, 1);
            }
        }
    }
    function setOn(kind, key, value) {
        const name = `${kind}:${key}`;
        const previous = onHandlers.get(name);
        if (previous)
            remove(kind, key.slice(2), previous);
        onHandlers.delete(name);
        if (typeof value === 'function' || value?.handleEvent) {
            onHandlers.set(name, value);
            add(kind, key.slice(2), value);
        }
    }
    const escapeId = (id) => realWindow.CSS?.escape ? realWindow.CSS.escape(id) : id.replace(/[^a-z0-9_-]/gi, character => `\\${character}`);
    const documentMethods = {
        querySelector: (selector) => root.querySelector(selector),
        querySelectorAll: (selector) => root.querySelectorAll(selector),
        getElementById: (id) => root.querySelector(`#${escapeId(String(id))}`),
        getElementsByClassName: (name) => html.getElementsByClassName(name),
        getElementsByTagName: (name) => name.toLowerCase() === 'html' ? [html] : html.getElementsByTagName(name),
        createElement: (name, options) => { const element = realDocument.createElement(name, options); prepareNode(element); return element; },
        createElementNS: realDocument.createElementNS.bind(realDocument),
        addEventListener: (type, listener, options) => add('document', type, listener, options),
        removeEventListener: (type, listener, options) => remove('document', type, listener, options),
        dispatchEvent: (event) => eventTarget('document', event.type).dispatchEvent(event),
        elementFromPoint: (x, y) => root.elementFromPoint?.(x, y) || realDocument.elementFromPoint(x, y),
        elementsFromPoint: (x, y) => root.elementsFromPoint?.(x, y) || realDocument.elementsFromPoint(x, y),
        getSelection: () => root.getSelection?.() || realWindow.getSelection(),
    };
    documentScope = new Proxy(realDocument, {
        get(target, key) {
            if (key in documentMethods)
                return documentMethods[String(key)];
            if (key === 'documentElement')
                return html;
            if (key === 'head')
                return head;
            if (key === 'body' || key === 'scrollingElement')
                return body;
            if (key === 'activeElement')
                return root.activeElement || body;
            if (key === 'defaultView')
                return scope;
            if (key === 'readyState')
                return started ? 'complete' : 'loading';
            if (key === 'styleSheets')
                return [...root.querySelectorAll('style')].map(style => style.sheet).filter(Boolean);
            if (typeof key === 'string' && key.startsWith('on'))
                return onHandlers.get(`document:${key}`) || null;
            const value = Reflect.get(target, key, target);
            return typeof value === 'function' ? value.bind(target) : value;
        },
        set(target, key, value) {
            if (typeof key === 'string' && key.startsWith('on')) {
                setOn('document', key, value);
                return true;
            }
            if (key === 'title') {
                realDocument.title = String(value);
                return true;
            }
            if (key === 'body') {
                body.replaceChildren(...value.childNodes);
                return true;
            }
            Reflect.set(target, key, value, target);
            return true;
        },
    });
    const windowMethods = {
        addEventListener: (type, listener, options) => add('window', type, listener, options),
        removeEventListener: (type, listener, options) => remove('window', type, listener, options),
        dispatchEvent: (event) => eventTarget('window', event.type).dispatchEvent(event),
        setTimeout: (callback, delay, ...args) => {
            if (!active || typeof callback !== 'function')
                return 0;
            const id = realWindow.setTimeout(() => { timeoutIds.delete(id); if (active)
                callback.apply(scope, args); }, delay);
            timeoutIds.add(id);
            return id;
        },
        clearTimeout: (id) => { timeoutIds.delete(id); realWindow.clearTimeout(id); },
        setInterval: (callback, delay, ...args) => {
            if (!active || typeof callback !== 'function')
                return 0;
            const id = realWindow.setInterval(() => { if (active)
                callback.apply(scope, args); }, delay);
            intervalIds.add(id);
            return id;
        },
        clearInterval: (id) => { intervalIds.delete(id); realWindow.clearInterval(id); },
        requestAnimationFrame: (callback) => {
            if (!active)
                return 0;
            const id = realWindow.requestAnimationFrame(time => { animationIds.delete(id); if (active)
                callback(time); });
            animationIds.add(id);
            return id;
        },
        cancelAnimationFrame: (id) => { animationIds.delete(id); realWindow.cancelAnimationFrame(id); },
    };
    const Url = new Proxy(realWindow.URL, { get(target, key) {
            if (key === 'createObjectURL')
                return (blob) => { const url = realWindow.URL.createObjectURL(blob); objectUrls.add(url); return url; };
            if (key === 'revokeObjectURL')
                return (url) => { objectUrls.delete(url); realWindow.URL.revokeObjectURL(url); };
            return Reflect.get(target, key, target);
        } });
    const AudioConstructor = new Proxy(realWindow.Audio, { construct(target, args) { const audio = Reflect.construct(target, args); media.add(audio); return audio; } });
    const AudioContextConstructor = realWindow.AudioContext && new Proxy(realWindow.AudioContext, { construct(target, args) { const context = Reflect.construct(target, args); audioContexts.add(context); return context; } });
    scope = new Proxy(Object.create(null), {
        get(_target, key) {
            if (key === 'window' || key === 'self' || key === 'globalThis')
                return scope;
            if (key === 'parent' || key === 'top')
                return realWindow[key] === realWindow ? scope : realWindow[key];
            if (key === 'document')
                return documentScope;
            if (key === 'URL')
                return Url;
            if (key === 'Audio')
                return AudioConstructor;
            if (key === 'AudioContext' || key === 'webkitAudioContext')
                return AudioContextConstructor;
            if (local.has(key))
                return local.get(key);
            if (typeof key === 'string' && UNAVAILABLE_MODULE_GLOBALS.has(key))
                return undefined;
            if (typeof key === 'string' && key.startsWith('on'))
                return onHandlers.get(`window:${key}`) || null;
            if (key in windowMethods)
                return windowMethods[String(key)];
            const value = Reflect.get(realWindow, key, realWindow);
            if (typeof key === 'string' && WINDOW_METHODS.has(key) && typeof value === 'function') {
                if (!boundMethods.has(key))
                    boundMethods.set(key, value.bind(realWindow));
                return boundMethods.get(key);
            }
            return value;
        },
        set(_target, key, value) {
            if (typeof key === 'string' && key.startsWith('on'))
                setOn('window', key, value);
            else
                local.set(key, value);
            return true;
        },
        has(_target, key) { return local.has(key) || key in windowMethods || key in realWindow; },
        deleteProperty(_target, key) { return local.delete(key); },
    });
    function start() {
        if (started || !active)
            return;
        started = true;
        readyTarget.dispatchEvent(new Event('DOMContentLoaded'));
        readyTarget.dispatchEvent(new Event('load'));
        syncFonts();
    }
    function dispose() {
        if (!active)
            return;
        // Persist the exact prototype's pending IndexedDB draft before detaching it.
        const pagehide = new Event('pagehide');
        for (const record of [...records]) {
            if (record.type === 'pagehide')
                record.wrapper(pagehide);
        }
        active = false;
        observer.disconnect();
        for (const record of records)
            record.target.removeEventListener(record.type, record.wrapper, record.capture);
        records.length = 0;
        for (const id of timeoutIds)
            realWindow.clearTimeout(id);
        for (const id of intervalIds)
            realWindow.clearInterval(id);
        for (const id of animationIds)
            realWindow.cancelAnimationFrame(id);
        for (const element of media) {
            try {
                element.pause();
                element.removeAttribute('src');
                element.load();
            }
            catch { /* detached or synthetic media */ }
        }
        for (const context of audioContexts) {
            try {
                void context.close();
            }
            catch { /* already closed */ }
        }
        for (const url of objectUrls)
            realWindow.URL.revokeObjectURL(url);
        fonts.remove();
        local.clear();
        root.replaceChildren();
    }
    return { root, html, body, global: scope, start, dispose };
}
