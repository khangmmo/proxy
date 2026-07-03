#!/bin/bash
echo "Running custom setup script..."
# Xóa file yarn.lock nếu tồn tại để đảm bảo npm được sử dụng
rm -f yarn.lock
# Chạy npm install
npm install