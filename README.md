# special-eureka-happyness

## Files
- `alfred-camera.user.js`: Adds UI and automation helpers, including:
  - `Refresh on Timeout` header toggle
  - post-refresh auto-camera navigation
  - keeps native DOWNLOAD behavior for clips
  - adds a separate `PLAY NOW` button to watch clips in-page
- `meeting-launcher-autoclose.user.js`: Adds a 15-minute top-center countdown banner on Webex/Teams launcher pages with **Close now** and **Cancel auto-close** actions, then attempts to close the tab automatically when time expires.
- `statejobsny-responsive.user.js`
  - Tampermonkey userscript for improving the layout on:
    - https://statejobsny.com/public/*
    - https://statejobsny.com/employees/*
  - 'What it changes'
    - Removes fixed-width constraints from the legacy wrapper elements (`#mainContent`, `#leftShadow`, `#rightShadow`) so content can use the full viewport.
    - Converts the old float-based `#nav` + `#content` structure into a responsive CSS grid layout that expands on desktop and stacks cleanly on smaller screens.
    - Keeps media and form controls from overflowing (`img`, `table`, `input`, `select`, `textarea`, etc.) and improves `#vacancyTable` sizing by centering the table and right-sizing narrow metadata columns so the Title column gets more room.
    - Centers the header and data cells for Item #, Grade, Posted, Deadline, and County columns; uses centered vertical alignment in the vacancy table.
    - Sets the vacancy results table entries-per-page default to `100` by setting the DataTables length select after initialization.
    - Adds a left-nav toggle (`Responsive layout`) under `Other State Listings` to turn all script changes on/off, default on, and remember preference via localStorage.
    - Adds a left-nav collapse button available at any viewport size that defaults open (`Collapse Left Navigation` when open, `☰ >` when collapsed/expandable), with a `#eee` background and responsive width so its right edge follows nav/helpful-links width on smaller viewports.
    - Keeps DataTables control rows laid out horizontally by not forcing width/min/max/box-sizing rules on `.dt-layout-row`.
    - Sets vacancy table body cell padding to `1px 3px`.
    - Lets the Agency column widen slightly when its cells wrap to 3+ lines, reducing excessive row height growth, and only applies Agency widening when it still fits without introducing table overflow.
    - Keeps vacancy table odd/even row striping in correct sequence after sorting/redraws.
    - On vacancy table Title-link hover, shows an overlay preview of the linked vacancy page with Job Specifics plus Basics content; the preview can be dragged by its header, closed with an `X` button or outside click, and keeps its position until moved.
    - In small viewports with collapsed left nav, reduces the vertical gap between the nav toggle box and the content heading area.
