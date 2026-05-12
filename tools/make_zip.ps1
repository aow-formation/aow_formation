$base = "C:\Claude\Age of war"
$dst  = "$base\_history\age_of_war_2026-05-07.zip"
$items = @("$base\web", "$base\GAME_DESIGN.md", "$base\tools")
Compress-Archive -Path $items -DestinationPath $dst -Force
Write-Host "done: $dst"
