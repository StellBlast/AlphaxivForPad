// ==UserScript==
// @name         alphaXiv iPadOS Dynamic Optimizer
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Optimizes alphaXiv for iPadOS Safari with dynamic DOM sniffing and bottom sheet sidebar.
// @author       Jules
// @match        *://*.alphaxiv.org/*
// @grant        GM_addStyle
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    console.log('alphaXiv iPadOS Dynamic Optimizer Loaded');

    // Utility for adding styles if GM_addStyle is not available
    function addStyle(css) {
        if (typeof GM_addStyle !== 'undefined') {
            GM_addStyle(css);
        } else {
            const inject = () => {
                const style = document.createElement('style');
                style.textContent = css;
                (document.head || document.documentElement).appendChild(style);
            };

            if (document.head || document.documentElement) {
                inject();
            } else {
                // Wait for head/documentElement if they don't exist yet (very rare in document-start)
                const observer = new MutationObserver(() => {
                    if (document.head || document.documentElement) {
                        observer.disconnect();
                        inject();
                    }
                });
                observer.observe(document, { childList: true, subtree: true });
            }
        }
    }

    const log = (msg) => console.log(`[alphaXiv-iPad] ${msg}`);

    class DOMScanner {
        constructor() {
            this.pdfContainer = null;
            this.sidebar = null;
            this.toolbar = null;
        }

        scan() {
            // New "Pair Finding" Strategy: Look for a layout where PDF and Sidebar are siblings
            // or close relatives. This is more robust than isolated searches.
            const candidates = Array.from(document.querySelectorAll('div, section, main, aside, nav, header'));
            const viewportW = window.innerWidth;
            const viewportH = window.innerHeight;

            const potentialSidebars = [];
            const potentialPDFs = [];
            let potentialToolbar = null;

            candidates.forEach(el => {
                const rect = el.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0 || el.style.display === 'none') return;

                const widthRatio = rect.width / viewportW;
                const heightRatio = rect.height / viewportH;

                // Heuristic for Sidebar: width 20-50%, reasonable height
                if (widthRatio >= 0.20 && widthRatio <= 0.50 && heightRatio > 0.5) {
                    potentialSidebars.push(el);
                }

                // Heuristic for PDF: width > 40%, reasonable height
                // Note: PDF width is often larger than Sidebar
                if (widthRatio > 0.40 && heightRatio > 0.5) {
                    potentialPDFs.push(el);
                }

                // Heuristic for Toolbar: Look for a narrow strip (vertical or horizontal)
                // that contains buttons (button, svg, a)
                if (!potentialToolbar) {
                     const isToolbarShape = (widthRatio > 0.8 && heightRatio < 0.15) || (widthRatio < 0.15 && heightRatio > 0.5);
                     if (isToolbarShape) {
                         const buttons = el.querySelectorAll('button, svg, a[role="button"]');
                         if (buttons.length > 2) {
                             potentialToolbar = el;
                         }
                     }
                }
            });

            // Attempt to find a pair that are siblings
            for (const sidebar of potentialSidebars) {
                const siblings = Array.from(sidebar.parentElement.children);

                // Check if any sibling is a potential PDF
                const pdfSibling = siblings.find(sib =>
                    sib !== sidebar && potentialPDFs.includes(sib)
                );

                if (pdfSibling) {
                    log(`Found Pair! PDF: <${pdfSibling.tagName}>, Sidebar: <${sidebar.tagName}>`);
                    this.pdfContainer = pdfSibling;
                    this.sidebar = sidebar;
                    if (potentialToolbar) this.toolbar = potentialToolbar;
                    return { pdf: this.pdfContainer, sidebar: this.sidebar, toolbar: this.toolbar };
                }
            }

            // Fallback: If no direct sibling pair, try "Uncle/Nephew" (wrapper scenario)
            // or revert to "Largest Element" logic for PDF + "Best Guess" for Sidebar
            log('Direct sibling pair not found. Trying fallback strategy...');
            this.findPDFContainerFallback();
            this.findSidebarFallback();

            return {
                pdf: this.pdfContainer,
                sidebar: this.sidebar,
                toolbar: this.toolbar
            };
        }

        findPDFContainerFallback() {
            // Original logic: Largest area > 40% viewport
            const candidates = Array.from(document.querySelectorAll('div, section, main'));
            let bestCandidate = null;
            let maxArea = 0;
            const viewportArea = window.innerWidth * window.innerHeight;

            candidates.forEach(el => {
                const rect = el.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0 || el.style.display === 'none') return;

                const area = rect.width * rect.height;
                // Exclude full-screen wrappers if possible (e.g. body, html are usually excluded by querySelectorAll unless explicitly targeted,
                // but huge divs exist). We prioritize slightly smaller than 100% width if possible to avoid wrappers.
                // But for safety, we just take the biggest.
                if (area > maxArea && area > (viewportArea * 0.4)) {
                    maxArea = area;
                    bestCandidate = el;
                }
            });

            if (bestCandidate) {
                log(`Fallback PDF found: <${bestCandidate.tagName.toLowerCase()} class="${bestCandidate.className}">`);
                this.pdfContainer = bestCandidate;
            }
        }

        findSidebarFallback() {
            if (!this.pdfContainer) return;

            // Look for siblings of PDF
            let siblings = Array.from(this.pdfContainer.parentElement.children);
            let sidebar = this.checkSiblingsForSidebar(siblings);

            if (!sidebar) {
                 // Look at parent's siblings (Wrapper case)
                 const wrapper = this.pdfContainer.parentElement;
                 if (wrapper && wrapper !== document.body && wrapper.parentElement) {
                     const wrapperSiblings = Array.from(wrapper.parentElement.children);
                     sidebar = this.checkSiblingsForSidebar(wrapperSiblings);
                 }
            }

            if (sidebar) {
                log(`Fallback Sidebar found: <${sidebar.tagName.toLowerCase()} class="${sidebar.className}">`);
                this.sidebar = sidebar;
            }
        }

        checkSiblingsForSidebar(siblings) {
            return siblings.find(el => {
                if (el === this.pdfContainer || (this.pdfContainer.parentElement && el === this.pdfContainer.parentElement)) return false;
                const rect = el.getBoundingClientRect();
                const widthRatio = rect.width / window.innerWidth;
                const heightRatio = rect.height / window.innerHeight;

                return widthRatio > 0.20 && widthRatio < 0.45 && heightRatio > 0.5;
            });
        }
    }

    class ToolManager {
        constructor(scanner, uiManager) {
            this.scanner = scanner;
            this.uiManager = uiManager;
            this.isToolsVisible = false;
            this.container = null;
            this.toggleButton = null;
            this.isZoomed = false;
            this.initStyles();
        }

        initStyles() {
             addStyle(`
                .ax-ipad-tools-panel {
                    position: fixed !important;
                    top: 50% !important;
                    right: 0 !important;
                    transform: translateY(-50%) translateX(100%);
                    width: 60px !important;
                    background: rgba(255, 255, 255, 0.95) !important;
                    backdrop-filter: blur(10px) !important;
                    -webkit-backdrop-filter: blur(10px) !important;
                    border-top-left-radius: 16px !important;
                    border-bottom-left-radius: 16px !important;
                    box-shadow: -4px 0 20px rgba(0,0,0,0.15) !important;
                    padding: 16px 8px !important;
                    display: flex !important;
                    flex-direction: column !important;
                    gap: 16px !important;
                    z-index: 10001 !important;
                    transition: transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
                }

                .ax-ipad-tools-visible {
                    transform: translateY(-50%) translateX(0%) !important;
                }

                .ax-ipad-tool-btn {
                    width: 44px;
                    height: 44px;
                    border-radius: 12px;
                    background: #f0f0f0;
                    border: none;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    color: #333;
                    font-size: 20px; /* Icon size */
                    transition: transform 0.1s, background 0.2s;
                }

                .ax-ipad-tool-btn:active {
                    transform: scale(0.92);
                    background: #e0e0e0;
                }

                .ax-ipad-tool-toggle {
                    position: fixed;
                    top: 50%;
                    right: 0;
                    transform: translateY(-50%);
                    width: 24px;
                    height: 48px;
                    background: #007AFF;
                    border-top-left-radius: 12px;
                    border-bottom-left-radius: 12px;
                    z-index: 10002;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    box-shadow: -2px 0 8px rgba(0,0,0,0.2);
                    transition: right 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
                }

                .ax-ipad-tool-toggle svg {
                    color: white;
                    width: 16px;
                    height: 16px;
                }

                /* Shift toggle when panel is visible */
                .ax-ipad-tools-visible + .ax-ipad-tool-toggle,
                .ax-ipad-tool-toggle.active {
                    right: 60px; /* Width of panel */
                    border-top-right-radius: 0;
                    border-bottom-right-radius: 0;
                }
            `);
        }

        createPanel() {
            if (this.container) return;

            this.container = document.createElement('div');
            this.container.className = 'ax-ipad-tools-panel';

            // Heuristic: If we found a toolbar, try to clone its buttons
            // Otherwise, provide default tools
            const tools = [
                { icon: '🖊️', action: () => this.simulateToolClick('highlight') },
                { icon: '💬', action: () => this.simulateToolClick('comment') },
                { icon: '📝', action: () => this.simulateToolClick('note') },
                { icon: '🔍', action: () => this.simulateToolClick('zoom') }
            ];

            tools.forEach(tool => {
                const btn = document.createElement('button');
                btn.className = 'ax-ipad-tool-btn';
                btn.innerHTML = tool.icon;
                btn.onclick = tool.action;
                // Handle touch
                btn.ontouchend = (e) => {
                    e.preventDefault();
                    tool.action();
                };
                this.container.appendChild(btn);
            });

            document.body.appendChild(this.container);

            // Create Toggle Handle
            this.toggleButton = document.createElement('div');
            this.toggleButton.className = 'ax-ipad-tool-toggle';
            this.toggleButton.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>`;
            this.toggleButton.onclick = () => this.togglePanel();
            document.body.appendChild(this.toggleButton);
        }

        togglePanel() {
            this.isToolsVisible = !this.isToolsVisible;
            if (this.isToolsVisible) {
                this.container.classList.add('ax-ipad-tools-visible');
                this.toggleButton.classList.add('active');
                this.toggleButton.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>`;
            } else {
                this.container.classList.remove('ax-ipad-tools-visible');
                this.toggleButton.classList.remove('active');
                this.toggleButton.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>`;
            }
        }

        simulateToolClick(type) {
            log(`Tool clicked: ${type}`);

            // Try to find the captured native bubble
            const nativeBubble = window.__ax_native_bubble;

            if (type === 'highlight' || type === 'comment') {
                if (nativeBubble && document.body.contains(nativeBubble)) {
                    // Try to find the specific button inside the bubble
                    // Usually there's a button with an icon or text related to comment/highlight
                    const buttons = Array.from(nativeBubble.querySelectorAll('button, a'));
                    // As a fallback, just click the first button if we can't be sure
                    let targetBtn = buttons[0];

                    if (targetBtn) {
                        targetBtn.click();
                        log(`Clicked native ${type} button inside bubble.`);
                    } else {
                         // Fallback: search entire DOM for something that looks like a comment button
                         const globalBtns = Array.from(document.querySelectorAll('button'));
                         const globalTarget = globalBtns.find(b => b.textContent.toLowerCase().includes(type) || b.innerHTML.includes('svg'));
                         if (globalTarget) globalTarget.click();
                    }
                } else {
                     log('Native bubble not found. Text must be selected first.');
                }
            } else if (type === 'note') {
                // Open the bottom sheet to view notes
                if (this.uiManager && !this.uiManager.isSidebarVisible) {
                    this.uiManager.toggleSidebar();
                }
            } else if (type === 'zoom') {
                // Toggle Zoom on PDF container
                const pdf = this.scanner.pdfContainer;
                if (pdf) {
                    this.isZoomed = !this.isZoomed;
                    if (this.isZoomed) {
                        pdf.style.transform = 'scale(1.2)';
                        pdf.style.transformOrigin = 'top center';
                        pdf.style.transition = 'transform 0.3s ease';
                    } else {
                        pdf.style.transform = 'scale(1)';
                    }
                }
            }
        }
    }

    class UIManager {
        constructor(scanner) {
            this.scanner = scanner;
            this.isSidebarVisible = false;
            this.fab = null;
            this.initStyles();
        }

        initStyles() {
            addStyle(`
                .ax-ipad-sidebar-sheet {
                    position: fixed !important;
                    bottom: 0 !important;
                    left: 0 !important;
                    width: 100% !important;
                    height: 60vh !important;
                    max-width: 100% !important;
                    z-index: 9999 !important;
                    transform: translateY(110%);
                    transition: transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
                    background: rgba(255, 255, 255, 0.95) !important;
                    backdrop-filter: blur(10px) !important;
                    -webkit-backdrop-filter: blur(10px) !important;
                    box-shadow: 0 -4px 20px rgba(0,0,0,0.15) !important;
                    border-top-left-radius: 16px !important;
                    border-top-right-radius: 16px !important;
                    overflow-y: auto !important;
                }

                .ax-ipad-sidebar-visible {
                    transform: translateY(0%) !important;
                }

                .ax-ipad-pdf-maximized {
                    width: 100% !important;
                    margin: 0 !important;
                    padding: 0 !important;
                    max-width: 100vw !important;
                }

                .ax-ipad-fab {
                    position: fixed;
                    bottom: 24px;
                    right: 24px;
                    width: 56px;
                    height: 56px;
                    border-radius: 50%;
                    background-color: #007AFF;
                    color: white;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
                    z-index: 10000;
                    cursor: pointer;
                    border: none;
                    outline: none;
                    transition: transform 0.2s;
                }

                .ax-ipad-fab:active {
                    transform: scale(0.95);
                }
            `);
        }

        transformSidebar() {
            const { sidebar, pdf } = this.scanner;

            if (sidebar) {
                sidebar.classList.add('ax-ipad-sidebar-sheet');
                // Ensure it has a background if the original didn't have one opaque enough
                if (window.getComputedStyle(sidebar).backgroundColor === 'rgba(0, 0, 0, 0)') {
                    sidebar.style.backgroundColor = '#fff';
                }
            }

            if (pdf) {
                pdf.classList.add('ax-ipad-pdf-maximized');
            }
        }

        injectFAB() {
            if (this.fab) return;

            this.fab = document.createElement('button');
            this.fab.className = 'ax-ipad-fab';
            this.fab.innerHTML = `
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                </svg>
            `;

            this.fab.addEventListener('click', () => this.toggleSidebar());
            document.body.appendChild(this.fab);
        }

        toggleSidebar() {
            const { sidebar } = this.scanner;
            if (!sidebar) return;

            this.isSidebarVisible = !this.isSidebarVisible;
            if (this.isSidebarVisible) {
                sidebar.classList.add('ax-ipad-sidebar-visible');
            } else {
                sidebar.classList.remove('ax-ipad-sidebar-visible');
            }
        }
    }

    class InteractionManager {
        constructor() {
            this.lastSelectionRect = null;
            this.observer = null;
            this.isInteracting = false;
        }

        init() {
            this.listenToSelection();
            this.hijackCommentBubble();
        }

        listenToSelection() {
            // Track selection changes
            const handleSelection = () => {
                const selection = window.getSelection();
                if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
                    const range = selection.getRangeAt(0);
                    this.lastSelectionRect = range.getBoundingClientRect();
                    this.isInteracting = true;

                    // Reset interaction flag after a delay
                    setTimeout(() => { this.isInteracting = false; }, 2000);
                } else {
                    this.isInteracting = false;
                }
            };

            document.addEventListener('selectionchange', () => {
                // Debounce selection change slightly
                setTimeout(handleSelection, 50);
            });

            // Mobile safari specific: ensure we capture touch end to validate selection
            document.addEventListener('touchend', () => {
                setTimeout(handleSelection, 100);
            });
        }

        hijackCommentBubble() {
            this.observer = new MutationObserver((mutations) => {
                if (!this.lastSelectionRect) return; // No active selection to attach to

                mutations.forEach((mutation) => {
                    if (mutation.addedNodes.length > 0) {
                        mutation.addedNodes.forEach((node) => {
                            if (node.nodeType === 1) { // Element node
                                this.checkAndRepositionBubble(node);
                            }
                        });
                    }
                });
            });

            this.observer.observe(document.body, { childList: true, subtree: true });
        }

        checkAndRepositionBubble(node) {
            const style = window.getComputedStyle(node);
            const isPositioned = style.position === 'absolute' || style.position === 'fixed';

            // Heuristic: Comment bubbles are usually small-ish, positioned absolute/fixed,
            // and appear right after an interaction/selection.
            // We also check if z-index is high.
            const zIndex = parseInt(style.zIndex, 10);
            const isHighZ = !isNaN(zIndex) && zIndex > 10;

            if (isPositioned && isHighZ && this.isInteracting) {
                log('Potential comment bubble detected. Repositioning to right edge...');
                // Store the bubble globally for the ToolManager to access
                window.__ax_native_bubble = node;
                this.repositionBubble(node);
            }
        }

        repositionBubble(element) {
             if (!this.lastSelectionRect) return;

             const rect = this.lastSelectionRect;

             // Move to the right side of the screen, aligned vertically with the selection
             // This avoids the iOS native text selection handles which appear directly above/below the text
             let top = rect.top;
             let right = 24; // 24px from the right edge

             // Screen boundaries check (keep it in viewport)
             const bubbleRect = element.getBoundingClientRect();
             if (top + bubbleRect.height > window.innerHeight - 20) {
                 top = window.innerHeight - bubbleRect.height - 20;
             }
             if (top < 80) { // Keep away from top edge/header
                 top = 80;
             }

             // Apply forced styles
             element.style.position = 'fixed'; // Ensure fixed to screen
             element.style.top = `${top}px`;
             element.style.left = `auto`; // Remove left positioning
             element.style.right = `${right}px`;
             element.style.transform = 'none'; // Remove any existing transforms that might mess up positioning
             element.style.marginTop = '0';
             element.style.marginLeft = '0';

             // Ensure it's very prominent
             element.style.zIndex = '10006';
             element.style.boxShadow = '0 8px 30px rgba(0,0,0,0.3)';
        }
    }

    // Main Execution
    const scanner = new DOMScanner();
    const uiManager = new UIManager(scanner);
    const toolManager = new ToolManager(scanner, uiManager);
    const interactionManager = new InteractionManager();

    // Wait for body to be ready for interaction manager
    const initInteraction = setInterval(() => {
        if (document.body) {
            clearInterval(initInteraction);
            interactionManager.init();
        }
    }, 100);

    const runScan = () => {
        const { pdf, sidebar, toolbar } = scanner.scan();
        if (pdf && sidebar) {
             uiManager.transformSidebar();
             uiManager.injectFAB();
             toolManager.createPanel();

             // If we found a native toolbar, hide it as we replaced it (optional, safe heuristic needed)
             if (toolbar && toolbar.style.display !== 'none') {
                 // log('Hiding native toolbar in favor of floating panel');
                 // toolbar.style.display = 'none'; // Commented out for safety until heuristic is battle-tested
             }

             return true; // Found and transformed
        }
        return false;
    };

    // 1. Immediate Attempt (might fail if DOM is empty)
    runScan();

    // 2. Aggressive Bootstrapper using MutationObserver
    // This catches elements as they are added to the DOM during initial load
    const bootstrapper = new MutationObserver((mutations) => {
        // Debounce slightly or just run. Since we want speed, we run directly but maybe check if it's worth it.
        // Simple check: if we found it, we can stop this observer or relax it.
        const success = runScan();
        if (success) {
            log('Initial layout found. Disconnecting bootstrapper.');
            bootstrapper.disconnect();
        }
    });

    // Start observing document element immediately
    bootstrapper.observe(document.documentElement, {
        childList: true,
        subtree: true
    });

    // 3. Fallback & SPA Navigation Handler
    // Keep a periodic check to handle route changes where the DOM might be replaced
    setInterval(runScan, 2000);

    // 4. Also run on standard window load events to be sure
    window.addEventListener('DOMContentLoaded', runScan);
    window.addEventListener('load', runScan);

})();
