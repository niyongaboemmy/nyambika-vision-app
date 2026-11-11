#!/usr/bin/env ruby
# E38: wire the native sources into ios/App/App.xcodeproj (idempotent).
#   - App target: local Live Activity plugin, bridge view controller, shared models, entitlements,
#     localized InfoPlist.strings (rw/en/fr)
#   - NyambikaWidgets app extension: WidgetKit "Today" widget + ActivityKit order Live Activity, embedded in the app
# Requires the `xcodeproj` gem (ships with CocoaPods). Run from apps/native: ruby scripts/ios-targets.rb
require "xcodeproj"

ROOT = File.expand_path("../ios/App", __dir__)
project = Xcodeproj::Project.open(File.join(ROOT, "App.xcodeproj"))
app = project.targets.find { |t| t.name == "App" } or abort("App target missing")
main_group = project.main_group

def file_ref(group, path)
  group.files.find { |f| f.path == path } || group.new_reference(path)
end

def add_sources(target, refs)
  refs.each { |r| target.source_build_phase.add_file_reference(r, true) unless target.source_build_phase.files_references.include?(r) }
end

# ── shared models ────────────────────────────────────────────────────────────
shared = main_group["Shared"] || main_group.new_group("Shared", "Shared")
shared_refs = %w[OrderActivityAttributes.swift WidgetOrderStore.swift].map { |f| file_ref(shared, f) }

# ── App target ───────────────────────────────────────────────────────────────
app_group = main_group["App"]
app_refs = %w[NyambikaLiveActivityPlugin.swift NyambikaBridgeViewController.swift].map { |f| file_ref(app_group, f) }
add_sources(app, app_refs + shared_refs)
file_ref(app_group, "App.entitlements")

# InfoPlist.strings as a localized variant group
variant = app_group.children.find { |c| c.isa == "PBXVariantGroup" && c.name == "InfoPlist.strings" }
unless variant
  variant = app_group.new_variant_group("InfoPlist.strings")
  %w[en rw fr].each { |l| variant.new_reference("#{l}.lproj/InfoPlist.strings").tap { |r| r.name = l; r.last_known_file_type = "text.plist.strings" } }
  app.resources_build_phase.add_file_reference(variant, true)
end
project.root_object.known_regions = (project.root_object.known_regions | %w[en rw fr Base])

app.build_configurations.each do |c|
  c.build_settings["CODE_SIGN_ENTITLEMENTS"] = "App/App.entitlements"
  c.build_settings["TARGETED_DEVICE_FAMILY"] = "1"
  c.build_settings["SWIFT_VERSION"] = "5.0"
end

# ── Widget extension ─────────────────────────────────────────────────────────
widget = project.targets.find { |t| t.name == "NyambikaWidgets" }
unless widget
  widget = project.new_target(:app_extension, "NyambikaWidgets", :ios, "17.0", nil, :swift)
end
wgroup = main_group["NyambikaWidgets"] || main_group.new_group("NyambikaWidgets", "NyambikaWidgets")
wrefs = %w[NyambikaWidgetsBundle.swift OrderLiveActivity.swift TodayWidget.swift].map { |f| file_ref(wgroup, f) }
file_ref(wgroup, "Info.plist")
file_ref(wgroup, "NyambikaWidgets.entitlements")
add_sources(widget, wrefs + shared_refs)
%w[WidgetKit SwiftUI ActivityKit].each do |fw|
  widget.add_system_framework(fw) unless widget.frameworks_build_phase.files_references.any? { |r| r.path.to_s.include?("#{fw}.framework") }
end
widget.build_configurations.each do |c|
  s = c.build_settings
  s["PRODUCT_BUNDLE_IDENTIFIER"] = "rw.nyambika.app.widgets"
  s["PRODUCT_NAME"] = "$(TARGET_NAME)"
  s["INFOPLIST_FILE"] = "NyambikaWidgets/Info.plist"
  s["GENERATE_INFOPLIST_FILE"] = "NO"
  s["CODE_SIGN_ENTITLEMENTS"] = "NyambikaWidgets/NyambikaWidgets.entitlements"
  s["CODE_SIGN_STYLE"] = "Automatic"
  s["IPHONEOS_DEPLOYMENT_TARGET"] = "17.0"
  s["SWIFT_VERSION"] = "5.0"
  s["TARGETED_DEVICE_FAMILY"] = "1"
  s["SKIP_INSTALL"] = "YES"
  s["APPLICATION_EXTENSION_API_ONLY"] = "YES"
  s["MARKETING_VERSION"] = "1.0"
  s["CURRENT_PROJECT_VERSION"] = "1"
  s["LD_RUNPATH_SEARCH_PATHS"] = ["$(inherited)", "@executable_path/Frameworks", "@executable_path/../../Frameworks"]
end

app.add_dependency(widget) unless app.dependencies.any? { |d| d.target == widget }
embed = app.copy_files_build_phases.find { |p| p.name == "Embed Foundation Extensions" }
unless embed
  embed = app.new_copy_files_build_phase("Embed Foundation Extensions")
  embed.dst_subfolder_spec = Xcodeproj::Constants::COPY_FILES_BUILD_PHASE_DESTINATIONS[:plug_ins]
end
unless embed.files_references.include?(widget.product_reference)
  bf = embed.add_file_reference(widget.product_reference, true)
  bf.settings = { "ATTRIBUTES" => ["RemoveHeadersOnCopy"] }
end

project.save
puts "App.xcodeproj: App (+plugin, entitlements, rw/en/fr strings) and NyambikaWidgets extension wired"
