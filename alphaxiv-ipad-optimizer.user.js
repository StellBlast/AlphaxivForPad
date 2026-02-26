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
        }

        scan() {
            // New "Pair Finding" Strategy: Look for a layout where PDF and Sidebar are siblings
            // or close relatives. This is more robust than isolated searches.
            const candidates = Array.from(document.querySelectorAll('div, section, main, aside'));
            const viewportW = window.innerWidth;
            const viewportH = window.innerHeight;

            const potentialSidebars = [];
            const potentialPDFs = [];

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
                    return { pdf: this.pdfContainer, sidebar: this.sidebar };
                }
            }

            // Fallback: If no direct sibling pair, try "Uncle/Nephew" (wrapper scenario)
            // or revert to "Largest Element" logic for PDF + "Best Guess" for Sidebar
            log('Direct sibling pair not found. Trying fallback strategy...');
            this.findPDFContainerFallback();
            this.findSidebarFallback();

            return {
                pdf: this.pdfContainer,
                sidebar: this.sidebar
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
            document.addEventListener('selectionchange', () => {
                const selection = window.getSelection();
                if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
                    const range = selection.getRangeAt(0);
                    this.lastSelectionRect = range.getBoundingClientRect();
                    this.isInteracting = true;
                    // Reset interaction flag after a delay
                    setTimeout(() => { this.isInteracting = false; }, 2000);
                }
            });

            // Mobile safari specific: ensure we capture touch end to validate selection
            document.addEventListener('touchend', () => {
                setTimeout(() => {
                    const selection = window.getSelection();
                    if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
                        const range = selection.getRangeAt(0);
                        this.lastSelectionRect = range.getBoundingClientRect();
                        this.isInteracting = true;
                    }
                }, 100); // Small delay to let selection finalize
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
                log('Potential comment bubble detected. Repositioning...');
                this.repositionBubble(node);
            }
        }

        repositionBubble(element) {
             if (!this.lastSelectionRect) return;

             const rect = this.lastSelectionRect;
             const bubbleRect = element.getBoundingClientRect();

             // Calculate optimal position (centered above selection, or below if no space)
             let top = rect.top - bubbleRect.height - 10;
             let left = rect.left + (rect.width / 2) - (bubbleRect.width / 2);

             // Screen boundaries check
             if (top < 10) {
                 // If too close to top, put it below
                 top = rect.bottom + 10;
             }

             // Horizontal clamping
             if (left < 10) left = 10;
             if (left + bubbleRect.width > window.innerWidth - 10) {
                 left = window.innerWidth - bubbleRect.width - 10;
             }

             // Apply forced styles
             element.style.position = 'fixed'; // Ensure fixed to screen
             element.style.top = `${top}px`;
             element.style.left = `${left}px`;
             element.style.transform = 'none'; // Remove any existing transforms that might mess up positioning
             element.style.marginTop = '0';
             element.style.marginLeft = '0';
        }
    }

    // Main Execution
    const scanner = new DOMScanner();
    const uiManager = new UIManager(scanner);
    const interactionManager = new InteractionManager();

    // Wait for body to be ready for interaction manager
    const initInteraction = setInterval(() => {
        if (document.body) {
            clearInterval(initInteraction);
            interactionManager.init();
        }
    }, 100);

    const runScan = () => {
        const { pdf, sidebar } = scanner.scan();
        if (pdf && sidebar) {
             uiManager.transformSidebar();
             uiManager.injectFAB();
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
