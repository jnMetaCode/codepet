#!/bin/bash
echo "🔧 正在修复 CodePet，需要输入 Mac 密码..."
sudo xattr -rd com.apple.quarantine /Applications/CodePet.app
if [ $? -eq 0 ]; then
    echo ""
    echo "✅ 修复完成！现在可以直接双击打开 CodePet 了。"
else
    echo ""
    echo "❌ 未找到 /Applications/CodePet.app，请先把 CodePet 拖进 Applications 文件夹再运行此脚本。"
fi
echo ""
read -p "按回车键关闭..."
