import 'package:flutter/services.dart' show PlatformException;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:image_picker/image_picker.dart';
import 'package:url_launcher/url_launcher.dart';

typedef LatLng = ({double lat, double lng});

/// Abstractions over platform services so screens stay testable.
abstract class LocationService {
  Future<bool> hasPermission();
  Future<bool> requestPermission();
  Future<LatLng?> current();
}

class DeviceLocationService implements LocationService {
  @override
  Future<bool> hasPermission() async {
    final p = await Geolocator.checkPermission();
    return p == LocationPermission.always || p == LocationPermission.whileInUse;
  }

  @override
  Future<bool> requestPermission() async {
    if (!await Geolocator.isLocationServiceEnabled()) return false;
    var p = await Geolocator.checkPermission();
    if (p == LocationPermission.denied) p = await Geolocator.requestPermission();
    return p == LocationPermission.always || p == LocationPermission.whileInUse;
  }

  @override
  Future<LatLng?> current() async {
    try {
      if (!await hasPermission()) return null;
      final pos = await Geolocator.getCurrentPosition(locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, timeLimit: Duration(seconds: 8)));
      return (lat: pos.latitude, lng: pos.longitude);
    } catch (_) {
      return null;
    }
  }
}

abstract class LinkOpener {
  Future<bool> open(Uri uri);
  Future<bool> call(String phone);
  /// The OS settings page of this app (to re-enable a permission the driver denied for good).
  Future<bool> openAppSettings();
}

class DeviceLinkOpener implements LinkOpener {
  @override
  Future<bool> open(Uri uri) async {
    try { return await launchUrl(uri, mode: LaunchMode.externalApplication); } catch (_) { return false; }
  }

  @override
  Future<bool> call(String phone) => open(Uri(scheme: 'tel', path: phone));

  @override
  Future<bool> openAppSettings() async { try { return await Geolocator.openAppSettings(); } catch (_) { return false; } }
}

final locationServiceProvider = Provider<LocationService>((_) => DeviceLocationService());
final linkOpenerProvider = Provider<LinkOpener>((_) => DeviceLinkOpener());

typedef PickedPhoto = ({String path, String name});

/// The camera could not be used. [denied] = the driver (or the OS policy) refused camera access, so the fix is in Settings.
class PhotoException implements Exception {
  PhotoException({required this.denied});
  final bool denied;
}

/// Camera access for the signed/stamped receipt photo. Abstracted so widget tests never open a real camera.
/// Returns null when the driver simply cancels; throws [PhotoException] when the camera is unusable.
abstract class PhotoPicker {
  Future<PickedPhoto?> takePhoto();
}

class DevicePhotoPicker implements PhotoPicker {
  @override
  Future<PickedPhoto?> takePhoto() => pickPhoto(ImageSource.camera);
}

/// Shared by the receipt flow and the documents screen: one place that turns plugin errors into [PhotoException].
Future<PickedPhoto?> pickPhoto(ImageSource source) async {
  try {
    final f = await ImagePicker().pickImage(source: source, maxWidth: 2000, imageQuality: 85);
    return f == null ? null : (path: f.path, name: f.name);
  } on PlatformException catch (e) {
    throw PhotoException(denied: e.code.contains('access_denied') || e.code.contains('permission'));
  } catch (_) {
    throw PhotoException(denied: false);
  }
}

final photoPickerProvider = Provider<PhotoPicker>((_) => DevicePhotoPicker());
