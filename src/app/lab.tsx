/*
 * The lab page's entry: nothing but the stylesheets, in the order the app
 * loads them, so an artboard in `lab.html` is judged under the real tokens and
 * the real Tailwind pass rather than under a `<link>` that skips both. No
 * React, no component - the frames are static markup, because Wave 1's check
 * is a screenshot of the CSS, not of a component that wraps it.
 */
import '../styles/theme.css';
import '../styles/primitives.css';
