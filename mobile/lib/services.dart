import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
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
}

class DeviceLinkOpener implements LinkOpener {
  @override
  Future<bool> open(Uri uri) async {
    try { return await launchUrl(uri, mode: LaunchMode.externalApplication); } catch (_) { return false; }
  }

  @override
  Future<bool> call(String phone) => open(Uri(scheme: 'tel', path: phone));
}

final locationServiceProvider = Provider<LocationService>((_) => DeviceLocationService());
final linkOpenerProvider = Provider<LinkOpener>((_) => DeviceLinkOpener());
