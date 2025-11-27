#!/bin/bash

if [ -z "$1" ]; then
  echo "Usage: npm run publish:otp 123456"
  echo "Please provide your OTP code as an argument"
  exit 1
fi

npm publish --access public --otp="$1"