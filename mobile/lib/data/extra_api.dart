import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'api_client.dart';
import 'models_extra.dart';

/// The field-operations additions (Addendum E) that live outside `DriverApi`: route geometry, cash, offers-while-busy, notifications by id, support tickets.
/// Uses the same [ApiClient] (auth header, retries on reads, error mapping) — one session, one connectivity indicator.
class ExtraApi {
  ExtraApi(this.c);
  final ApiClient c;

  // ── route map (E6) ──
  Future<RouteGeometry> routeGeometry(String offerId) async => RouteGeometry.fromJson(await c.get('/driver/jobs/$offerId/route-geometry'));

  // ── cash with me (E17) ──
  Future<CashSummary> cash() async => CashSummary(await c.get('/driver/cash'));

  // ── offers while busy (E11) ──
  Future<OffersInfo> offersInfo() async => OffersInfo.fromJson(await c.get('/driver/offers'));
  Future<OffersInfo> opportunitiesInfo() async => OffersInfo.fromJson(await c.get('/driver/opportunities'));

  // ── notifications (E12) ──
  /// Unread notifications, newest first. The contract names the filter `unreadOnly`; the existing route reads `unread` — both are sent so it works either way.
  Future<List<AppNotification>> unreadNotifications() async => parseNotifications(await c.get('/notifications', query: {'unreadOnly': 1, 'unread': 1}));
  Future<void> markRead({List<String>? ids}) async { await c.post('/notifications/read', {if (ids != null && ids.isNotEmpty) 'ids': ids}); }

  // ── support tickets (E15) ──
  Future<List<Ticket>> tickets() async => parseTickets(await c.get('/tickets'));
  Future<TicketThread> ticket(String id) async => TicketThread(await c.get('/tickets/$id'));
  Future<Ticket> createTicket({required String category, required String subject, String? body, String? offerId, List<String> attachmentIds = const []}) async =>
      Ticket(await c.post('/tickets', {'category': category, 'subject': subject, if (body != null && body.trim().isNotEmpty) 'body': body, 'offerId': ?offerId, if (attachmentIds.isNotEmpty) 'attachmentIds': attachmentIds}));
  Future<void> replyTicket(String id, String body, {List<String> attachmentIds = const []}) async { await c.post('/tickets/$id/replies', {'body': body, if (attachmentIds.isNotEmpty) 'attachmentIds': attachmentIds}); }
  Future<Ticket> reopenTicket(String id, {String? body}) async => Ticket(await c.post('/tickets/$id/reopen', {if (body != null && body.trim().isNotEmpty) 'body': body}));
  Future<Ticket> resolveTicket(String id) async => Ticket(await c.post('/tickets/$id/resolve'));

  /// `POST /uploads/ticket` (multipart `file`; jpg/png/webp/pdf ≤ 8 MB). The returned id goes into `attachmentIds` of the next ticket / reply.
  Future<UploadedFile> uploadTicketFile(String path, String filename, {void Function(double progress)? onProgress}) async {
    final form = FormData.fromMap({'file': await MultipartFile.fromFile(path, filename: filename, contentType: DioMediaType.parse(mimeOf(filename)))});
    return UploadedFile(await c.postForm('/uploads/ticket', form, onProgress: onProgress));
  }

  /// The attachment's bytes (`GET /tickets/attachments/:id` needs the auth header, so an `Image.network` cannot be used).
  Future<Uint8List> attachmentBytes(String id) async {
    try {
      final r = await c.dio.get<List<int>>('/tickets/attachments/$id', options: Options(responseType: ResponseType.bytes, receiveTimeout: const Duration(seconds: 60)));
      c.onConnectivity?.call(true);
      final d = r.data;
      if (d == null || d.isEmpty) throw ApiException('BAD_RESPONSE', 'empty attachment', status: r.statusCode ?? 0);
      return Uint8List.fromList(d);
    } on DioException catch (e) {
      final status = e.response?.statusCode ?? 0;
      if (status == 401) { c.onUnauthorized?.call(); throw ApiException('UNAUTHENTICATED', 'unauthenticated', status: status); }
      if (status == 404) throw ApiException('NOT_FOUND', 'attachment not found', status: status);
      if (status == 403) throw ApiException('FORBIDDEN', 'forbidden', status: status);
      if (e.type == DioExceptionType.badResponse) throw ApiException('INTERNAL', e.message ?? 'bad response', status: status);
      c.onConnectivity?.call(false);
      throw ApiException(e.type == DioExceptionType.connectionTimeout || e.type == DioExceptionType.receiveTimeout ? 'TIMEOUT' : 'NETWORK', e.message ?? 'network error');
    }
  }

  static String mimeOf(String f) {
    final l = f.toLowerCase();
    return l.endsWith('.png') ? 'image/png' : l.endsWith('.pdf') ? 'application/pdf' : l.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
  }
}
