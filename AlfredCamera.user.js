// ==UserScript==
// @name         AlfredCamera
// @namespace    http://tampermonkey.net/
// @version      2026-03-08
// @description  Alfred WebViewer helpers: hide support modal, optional timeout refresh, and auto camera navigation.
// @author       You
// @match        https://alfred.camera/webapp/viewer/device/58b0706437d9dc302f02532b80373858/live
// @icon         https://www.google.com/s2/favicons?sz=64&domain=alfred.camera
// @grant        none
// @updateURL    https://github.com/silentsteel875/special-eureka-happyness/raw/refs/heads/main/AlfredCamera.user.js
// @downloadURL  https://github.com/silentsteel875/special-eureka-happyness/raw/refs/heads/main/AlfredCamera.user.js
// ==/UserScript==

(function () {
    'use strict';

    const REFRESH_ON_TIMEOUT_KEY = 'alfred.refreshOnTimeout.enabled';
    const PENDING_RESTORE_KEY = 'alfred.refreshOnTimeout.pendingRestore';
    const TARGET_CAMERA_TEXT = 'Garage Door'; // Change this if you want another camera.
    let lastKnownDownloadUrl = null;

    function isRefreshOnTimeoutEnabled() {
        return localStorage.getItem(REFRESH_ON_TIMEOUT_KEY) === '1';
    }

    function setRefreshOnTimeoutEnabled(enabled) {
        localStorage.setItem(REFRESH_ON_TIMEOUT_KEY, enabled ? '1' : '0');
    }

    function isVisible(element) {
        if (!element) return false;
        const style = window.getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    }

    function createHeaderToggle() {
        if (document.querySelector('#tm-refresh-on-timeout-toggle')) return;

        const headerToolbar = document.querySelector('header[name="main-header"] .MuiToolbar-root');
        if (!headerToolbar) return;

        const wrap = document.createElement('label');
        wrap.id = 'tm-refresh-on-timeout-toggle';
        wrap.style.display = 'inline-flex';
        wrap.style.alignItems = 'center';
        wrap.style.gap = '6px';
        wrap.style.marginLeft = '12px';
        wrap.style.marginRight = '12px';
        wrap.style.fontSize = '12px';
        wrap.style.fontFamily = 'Roboto, sans-serif';
        wrap.style.fontWeight = '500';
        wrap.style.color = '#1A1A1A';
        wrap.style.userSelect = 'none';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = isRefreshOnTimeoutEnabled();
        checkbox.style.cursor = 'pointer';
        checkbox.addEventListener('change', () => {
            setRefreshOnTimeoutEnabled(checkbox.checked);
            console.log(`[TM] Refresh on Timeout: ${checkbox.checked ? 'ON' : 'OFF'}`);
        });

        const text = document.createElement('span');
        text.textContent = 'Refresh on Timeout';

        wrap.appendChild(checkbox);
        wrap.appendChild(text);

        // Keep this control in the yellow header near existing controls.
        const cameraButton = headerToolbar.querySelector('button[aria-label="CameraList"]');
        if (cameraButton) {
            cameraButton.insertAdjacentElement('beforebegin', wrap);
        } else {
            headerToolbar.appendChild(wrap);
        }
    }

    function isTimeoutDialogShown() {
        const dialogs = Array.from(document.querySelectorAll('.MuiDialog-root.MuiModal-root'));

        return dialogs.some((dialog) => {
            if (!isVisible(dialog)) return false;

            const titleNode = dialog.querySelector('h2#form-dialog-title, h2');
            const dialogText = `${titleNode?.textContent || ''} ${dialog.textContent || ''}`.toLowerCase();

            return /session\s*(has\s*)?(timed\s*out|timeout)|timed\s*out|session\s*expired/.test(dialogText);
        });
    }

    function clickElement(el) {
        if (!el) return false;
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return true;
    }

    function tryAutoNavigateToCamera() {
        const cameraListButton = document.querySelector('button[aria-label="CameraList"]');
        if (cameraListButton) {
            clickElement(cameraListButton);
        }

        const allNodes = Array.from(document.querySelectorAll('span, button, div[role="button"], li, p'));
        const targetNode = allNodes.find((node) => {
            const text = (node.textContent || '').trim();
            return text.toLowerCase().includes(TARGET_CAMERA_TEXT.toLowerCase());
        });

        if (!targetNode) return false;

        const clickable = targetNode.closest('button, [role="button"], .MuiListItem-button') || targetNode;
        return clickElement(clickable);
    }

    function restoreCameraAfterReload() {
        if (sessionStorage.getItem(PENDING_RESTORE_KEY) !== '1') return;

        sessionStorage.removeItem(PENDING_RESTORE_KEY);

        let attempts = 0;
        const maxAttempts = 20;

        const timer = setInterval(() => {
            attempts += 1;
            const clicked = tryAutoNavigateToCamera();

            if (clicked) {
                clearInterval(timer);
                console.log(`[TM] Reopened camera: ${TARGET_CAMERA_TEXT}`);
                return;
            }

            if (attempts >= maxAttempts) {
                clearInterval(timer);
                console.warn(`[TM] Could not find target camera: ${TARGET_CAMERA_TEXT}`);
            }
        }, 1000);
    }

    function handleSupportModal() {
        const targetElement = document.querySelector('.MuiDialog-root.MuiModal-root.css-126xj0f');
        const h2Element = document.querySelector('h2#form-dialog-title');

        if (
            targetElement &&
            h2Element &&
            h2Element.textContent.trim() === 'Alfred Needs Your Support!'
        ) {
            targetElement.style.display = 'none';
            console.log('[TM] Target support dialog hidden');
        }
    }

    function handleTimeoutRefresh() {
        if (!isRefreshOnTimeoutEnabled()) return;
        if (!isTimeoutDialogShown()) return;

        console.log('[TM] Session timeout dialog detected. Reloading...');
        sessionStorage.setItem(PENDING_RESTORE_KEY, '1');
        window.location.reload();
    }

    function ensureVideoPlayer() {
        let videoPlayer = document.querySelector('#tampermonkey-video-player');
        if (!videoPlayer) {
            videoPlayer = document.createElement('video');
            videoPlayer.id = 'tampermonkey-video-player';
            videoPlayer.controls = true;
            videoPlayer.style.width = '80vw';
            videoPlayer.style.maxWidth = '1100px';
            videoPlayer.style.maxHeight = '80vh';
            videoPlayer.style.zIndex = '999999';
            videoPlayer.style.background = '#000';
            videoPlayer.style.position = 'fixed';
            videoPlayer.style.top = '50%';
            videoPlayer.style.left = '50%';
            videoPlayer.style.transform = 'translate(-50%, -50%)';
            videoPlayer.style.boxShadow = '0px 8px 24px rgba(0, 0, 0, 0.65)';
            videoPlayer.style.border = '1px solid rgba(255,255,255,0.2)';
            videoPlayer.style.borderRadius = '6px';

            const closeButton = document.createElement('button');
            closeButton.id = 'tampermonkey-video-player-close';
            closeButton.type = 'button';
            closeButton.textContent = '✕';
            closeButton.style.position = 'fixed';
            closeButton.style.top = 'calc(10vh - 20px)';
            closeButton.style.right = 'calc(10vw - 20px)';
            closeButton.style.zIndex = '1000000';
            closeButton.style.width = '34px';
            closeButton.style.height = '34px';
            closeButton.style.border = 'none';
            closeButton.style.borderRadius = '17px';
            closeButton.style.cursor = 'pointer';
            closeButton.style.fontSize = '18px';
            closeButton.style.background = '#ff7600';
            closeButton.style.color = '#fff';
            closeButton.style.boxShadow = '0px 2px 8px rgba(0, 0, 0, 0.5)';
            closeButton.addEventListener('click', () => {
                videoPlayer.pause();
                videoPlayer.removeAttribute('src');
                videoPlayer.load();
                videoPlayer.style.display = 'none';
                closeButton.style.display = 'none';
            });

            document.body.appendChild(videoPlayer);
            document.body.appendChild(closeButton);
        }

        return {
            videoPlayer,
            closeButton: document.querySelector('#tampermonkey-video-player-close')
        };
    }

    function playVideoInline(videoUrl) {
        const { videoPlayer, closeButton } = ensureVideoPlayer();
        videoPlayer.style.display = 'block';
        closeButton.style.display = 'block';
        videoPlayer.src = videoUrl;
        videoPlayer.play();
        console.log(`[TM] Playing video from: ${videoUrl}`);
    }

    function isLikelyDownloadControl(el) {
        if (!el) return false;
        if (el.dataset.tmPlayNowButton === '1') return false;

        const text = (el.textContent || '').trim().toLowerCase();
        const aria = (el.getAttribute('aria-label') || '').trim().toLowerCase();
        return text.includes('download') || aria.includes('download');
    }

    function extractUrlFromBackgroundImage(styleValue) {
        if (!styleValue) return null;
        const match = styleValue.match(/url\((['"]?)(.*?)\1\)/i);
        return match?.[2] || null;
    }

    function isInvalidDataVideoUrl(url) {
        if (!/^data:video\//i.test(url || '')) return false;

        const lower = url.toLowerCase();
        const base64Index = lower.indexOf('base64,');
        if (base64Index === -1) return false;

        const payloadStart = base64Index + 'base64,'.length;
        const head = lower.slice(payloadStart, payloadStart + 16);

        // JPEG (/9j) and PNG (iVBOR) are common image prefixes that cannot be played by <video>.
        return head.startsWith('/9j') || head.startsWith('ivbor');
    }

    function isPlayableUrl(url) {
        if (!url) return false;
        if (isInvalidDataVideoUrl(url)) return false;

        return (
            /^data:video\//i.test(url) ||
            /\.mp4(\?|$)/i.test(url) ||
            /^blob:/i.test(url)
        );
    }

    async function normalizePlayableUrl(url) {
        if (!isPlayableUrl(url)) return null;

        if (!/^blob:/i.test(url)) return url;

        try {
            const response = await fetch(url);
            const blob = await response.blob();
            if (!blob || !/^video\//i.test(blob.type || '')) return url;

            return URL.createObjectURL(blob);
        } catch (error) {
            console.warn('[TM] Could not normalize blob URL for inline playback, using original URL.', error);
            return url;
        }
    }

    function installDownloadPathProbe() {
        if (window.__tmDownloadProbeInstalled) return;
        window.__tmDownloadProbeInstalled = true;

        const originalCreateObjectURL = URL.createObjectURL.bind(URL);
        URL.createObjectURL = function patchedCreateObjectURL(blob) {
            const blobUrl = originalCreateObjectURL(blob);
            if (blob && /^video\//i.test(blob.type || '')) {
                lastKnownDownloadUrl = blobUrl;
                console.log('[TM] Captured video blob URL from download flow.');
            }
            return blobUrl;
        };

        const originalAnchorClick = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function patchedAnchorClick() {
            const href = this.href || this.getAttribute('href') || '';
            if (isPlayableUrl(href)) {
                lastKnownDownloadUrl = href;
                console.log('[TM] Captured playable anchor URL from download flow.');
            }
            return originalAnchorClick.apply(this, arguments);
        };
    }

    function getSelectedClipPreviewUrl() {
        const listItems = Array.from(document.querySelectorAll('.MuiImageListItem-root'));

        for (const item of listItems) {
            const bar = item.querySelector('.MuiImageListItemBar-root');
            if (!bar) continue;

            const bg = window.getComputedStyle(bar).backgroundColor.replace(/\s+/g, '');
            const isSelected = bg === 'rgb(253,151,40)' || bg === 'rgba(253,151,40,0.8)';
            if (!isSelected) continue;

            const thumb = item.querySelector('[style*="background-image"]');
            if (!thumb) continue;

            const styleValue = thumb.style?.backgroundImage || thumb.getAttribute('style') || '';
            const url = extractUrlFromBackgroundImage(styleValue);
            if (isPlayableUrl(url)) return url;
        }

        return null;
    }

    function resolveClipUrl(downloadControl) {
        if (!downloadControl) return null;

        if (downloadControl.matches('a[href]')) {
            const directHref = downloadControl.getAttribute('href');
            if (isPlayableUrl(directHref)) {
                return downloadControl.href;
            }
        }

        if (isPlayableUrl(lastKnownDownloadUrl)) {
            return lastKnownDownloadUrl;
        }

        const nearbyAnchor = downloadControl.parentElement?.querySelector('a[href]');
        if (isPlayableUrl(nearbyAnchor?.href)) return nearbyAnchor.href;

        const inRowAnchor = downloadControl.closest('li, div, section, article')?.querySelector('a[href]');
        if (isPlayableUrl(inRowAnchor?.href)) return inRowAnchor.href;

        const fromSelected = getSelectedClipPreviewUrl();
        if (fromSelected) return fromSelected;

        return null;
    }

    function findDownloadControls() {
        const candidates = Array.from(document.querySelectorAll('a, button, [role="button"]'));
        return candidates.filter((el) => {
            if (!isLikelyDownloadControl(el)) return false;
            return isVisible(el);
        });
    }

    function addPlayNowButton(downloadControl) {
        if (!downloadControl || downloadControl.dataset.tmPlayNowAttached === '1') return;

        const playNowButton = document.createElement('button');
        playNowButton.type = 'button';
        playNowButton.className = downloadControl.className;
        playNowButton.dataset.tmPlayNowButton = '1';
        playNowButton.style.marginLeft = '8px';
        playNowButton.style.display = 'inline-flex';
        playNowButton.style.alignItems = 'center';
        playNowButton.style.gap = '6px';
        playNowButton.style.cursor = 'pointer';
        playNowButton.innerHTML = '<span aria-hidden="true">▶</span><span>PLAY NOW</span>';

        playNowButton.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();

            const videoUrl = resolveClipUrl(downloadControl);

            if (!isPlayableUrl(videoUrl)) {
                console.warn('[TM] PLAY NOW could not determine a playable video URL from selected clip context or prior download path.');
                return;
            }

            const normalizedVideoUrl = await normalizePlayableUrl(videoUrl);
            if (!normalizedVideoUrl) {
                console.warn('[TM] PLAY NOW could not normalize the selected URL into a playable source.');
                return;
            }

            playVideoInline(normalizedVideoUrl);
        });

        downloadControl.insertAdjacentElement('afterend', playNowButton);
        downloadControl.dataset.tmPlayNowAttached = '1';
        console.log('[TM] PLAY NOW button injected.');
    }

    function ensurePlayNowButtons() {
        const controls = findDownloadControls();
        controls.forEach(addPlayNowButton);
    }

    function findLiveViewerLayoutCandidates() {
        const allDivs = Array.from(document.querySelectorAll('div'));

        return allDivs.filter((el) => {
            const style = window.getComputedStyle(el);
            if (style.display !== 'grid') return false;
            if (!style.gridTemplateRows || style.gridTemplateRows === 'none') return false;

            const hasVideoContent = Boolean(
                el.querySelector('video, .video-js, [data-vjs-player], img[alt="camera snapshot"]')
            );
            if (!hasVideoContent) return false;

            const hasTimelineOrEventBook = Boolean(
                el.querySelector('ul.MuiImageList-root, [name="event-item-back-button"], [class*="eventbook"]')
            );

            return hasTimelineOrEventBook;
        });
    }

    function enforceLargerLiveViewerLayout() {
        const candidates = findLiveViewerLayoutCandidates();
        if (!candidates.length) return;

        for (const liveLayout of candidates) {
            if (liveLayout.dataset.tmLargeViewerApplied === '1') continue;

            // Equivalent to the DevTools tweak: disable restrictive grid sizing.
            liveLayout.style.display = 'block';
            liveLayout.style.gridTemplateRows = 'unset';
            liveLayout.dataset.tmLargeViewerApplied = '1';

            console.log('[TM] Applied larger live-viewer layout override.');
        }
    }

    // Observe the page for app updates
    const observer = new MutationObserver(() => {
        createHeaderToggle();
        handleSupportModal();
        handleTimeoutRefresh();
        ensurePlayNowButtons();
        enforceLargerLiveViewerLayout();
    });

    // Observe the page for download controls
    const observerVideo = new MutationObserver(() => {
        ensurePlayNowButtons();
        enforceLargerLiveViewerLayout();
    });

    // Initialize once immediately.
    createHeaderToggle();
    handleSupportModal();
    restoreCameraAfterReload();
    installDownloadPathProbe();
    ensurePlayNowButtons();
    enforceLargerLiveViewerLayout();

    // Fallback poll in case clip row updates without subtree mutations in some virtualized views.
    setInterval(() => {
        ensurePlayNowButtons();
        enforceLargerLiveViewerLayout();
    }, 2000);

    observer.observe(document.body, { childList: true, subtree: true });
    observerVideo.observe(document.body, { childList: true, subtree: true });
})();
