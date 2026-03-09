// ==UserScript==
// @name         Family Search - Hide/Unhide Toggle
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Hides specific buttons and their separators on a Family Search, with a toggle link.
// @author       Ken Prunier
// @match        https://ident.familysearch.org/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Function to set element display
    const setElementDisplay = (element, displayValue) => {
        if (element) {
            element.style.display = displayValue;
        }
    };

    const targetElements = []; // Array to store the elements we hide/show

    const runHidingLogic = () => {
        const elementGoogle = document.querySelector('.css-18wpbhm-baseButtonCss-googleButtonCss');
        const elementFB = document.querySelector('.css-9xigz9-baseButtonCss-facebookButtonCss');
        const elementApple = document.querySelector('.css-1jeafhi-baseButtonCss-appleButtonCss');
        const elementChurch = document.querySelector('.css-6jbg67-baseButtonCss-churchButtonCss');
        const elementOrLine = document.querySelector('.css-8mqnaq-signUpDividerCss');

        const elementsToManage = [elementGoogle, elementFB, elementApple, elementChurch, elementOrLine];

        if (elementsToManage.every(el => el !== null)) { // Check if all target elements are found
             elementsToManage.forEach(element => {
                targetElements.push(element); // Store the main element

                const elementSeparator = element.nextElementSibling;
                 if (elementSeparator && elementSeparator.classList && elementSeparator.classList.contains('separatorCss_s1wrc5wj')) {
                    targetElements.push(elementSeparator); // Store the separator
                }
            });

            // Initially hide the elements
            toggleVisibility(false); // false means hide

            return true; // Indicate that elements were found and initially hidden
        }
        return false; // Indicate that not all elements were found
    };

    // Function to toggle the visibility of the stored elements
    const toggleVisibility = (show) => {
        targetElements.forEach(element => {
            setElementDisplay(element, show ? '' : 'none');
        });
    };

    // Function to add the toggle link
    function addToggleButton() {
        const toggleLink = document.createElement('a');
        toggleLink.href = '#'; // Prevent page reload
        toggleLink.textContent = 'Show hidden content'; // Initial text
        toggleLink.style.position = 'fixed';
        toggleLink.style.bottom = '10px';
        toggleLink.style.right = '10px';
        toggleLink.style.backgroundColor = '#f0f0f0';
        toggleLink.style.padding = '5px 10px';
        toggleLink.style.border = '1px solid #ccc';
        toggleLink.style.zIndex = '1000';
        toggleLink.style.textDecoration = 'none';
        toggleLink.style.color = '#333';
        toggleLink.style.fontSize = '12px';

        let isHidden = true; // Track the current state (initially hidden)

        toggleLink.addEventListener('click', (event) => {
            event.preventDefault();

            if (isHidden) {
                toggleVisibility(true); // Show the elements
                toggleLink.textContent = 'Hide content'; // Change link text
            } else {
                toggleVisibility(false); // Hide the elements
                toggleLink.textContent = 'Show hidden content'; // Change link text
            }

            isHidden = !isHidden; // Toggle the state
        });

        document.body.appendChild(toggleLink);
    }

    // --- MutationObserver setup ---
    const targetNode = document.body;
    const config = { childList: true, subtree: true };

    const observer = new MutationObserver((mutationsList, observer) => {
        for (const mutation of mutationsList) {
            if (mutation.type === 'childList') {
                if (runHidingLogic()) {
                    observer.disconnect();
                    addToggleButton(); // Add the toggle button once elements are handled
                    break;
                }
            }
        }
    });

    // Start observing
    observer.observe(targetNode, config);

    // Initial check and add button if elements are already there
    if (runHidingLogic()) {
        observer.disconnect();
        addToggleButton(); // Add the toggle button if found immediately
    }

})();
