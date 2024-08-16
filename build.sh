#!/bin/bash

if [ ! -d target ]; then mkdir target; fi
cp -r web/* target/
rm target/calculate-core.js
npx google-closure-compiler --js=web/calculate-core.js --language_in=ECMASCRIPT_NEXT --language_out=ECMASCRIPT_NEXT --compilation_level=ADVANCED_OPTIMIZATIONS > target/calculate-core.js
