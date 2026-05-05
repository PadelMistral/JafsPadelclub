const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const cssDir = path.join(rootDir, 'css');

// We need to restore the HTML files from the git repository if possible, or just re-add the missing CSS classes.
// Wait, the HTML files were modified to remove all <link rel="stylesheet">. That's fine, we will just include ALL CSS files into bundle.min.css.

console.log("Reading all CSS files...");
const allCssFiles = fs.readdirSync(cssDir).filter(f => f.endsWith('.css') && f !== 'bundle.min.css');

// Order matters:
// 1. Core/Base
// 2. Tokens/Variables
// 3. Global Layout/Components
// 4. Specific Pages
// 5. Enhancements/Overrides (themes, final-polish, responsive)

const priority = {
    'core-bundle.css': 1,
    'design-tokens.css': 2,
    'global.css': 3,
    'design-system.css': 4,
    'layout.css': 5,
    'components-premium.css': 6,
    'premium-v7.css': 7,
    'master-polish.css': 8,
    'padel-fusion.css': 9,
    'fixes-patch.css': 10,
    // (Pages will be around priority 50)
    'responsive-enhance.css': 90,
    'themes.css': 95,
    'final-polish.css': 100
};

allCssFiles.sort((a, b) => {
    const pA = priority[a] || 50;
    const pB = priority[b] || 50;
    return pA - pB;
});

console.log("Order of CSS files:");
allCssFiles.forEach(f => console.log(f));

let bundle = '';
for (const file of allCssFiles) {
    const fullPath = path.join(cssDir, file);
    if (fs.existsSync(fullPath)) {
        bundle += `\n/* --- ${file} --- */\n`;
        // Strip @import rules because they must be at the top or we just concat them
        let content = fs.readFileSync(fullPath, 'utf8');
        content = content.replace(/@import url\([^)]+\);?/g, '');
        bundle += content + '\n';
    }
}

console.log("Minifying...");
bundle = bundle.replace(/\/\*[\s\S]*?\*\//g, '')
               .replace(/\s+/g, ' ')
               .replace(/\s*([{}:;,>])\s*/g, '$1')
               .replace(/;}/g, '}');

const bundlePath = path.join(cssDir, 'bundle.min.css');
fs.writeFileSync(bundlePath, bundle);
console.log(`Saved bundle to ${bundlePath} (${(bundle.length / 1024).toFixed(1)} KB)`);
